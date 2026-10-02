import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { Store } from "../server/store.ts";
import { Assets } from "../server/assets.ts";
import { CmsError } from "../shared.ts";
import { Publisher } from "../server/publish.ts";
import { createApp } from "../server/app.ts";
import { renderPreview } from "../server/preview.ts";
import { backup, restoreStagedAssets } from "../server/backup.ts";
import { sanitizeImage, stripImageMetadata } from "../server/image-sanitize.ts";
import type { ImageStorage, RemoteImage } from "../server/r2.ts";
import { writeFixtureContent } from "../../tests/fixtures.ts";
import { managedImage, resolveAssetUrl } from "../../src/lib/assets.ts";
import { EditorState } from "@codemirror/state";
import {
  imageAnchors,
  addImageAnchor,
  removeImageAnchor,
} from "../client/image-anchors.ts";
class FakeStorage implements ImageStorage {
  objects = new Map<string, RemoteImage>();
  puts = 0;
  heads = 0;
  fail = false;
  crash = false;
  async head(key: string) {
    this.heads++;
    return this.objects.get(key) ?? null;
  }
  async put(key: string, _file: string, value: RemoteImage) {
    this.puts++;
    if (this.fail)
      throw new CmsError(502, "이미지 저장소에 연결하지 못했습니다.");
    if (!this.objects.has(key)) this.objects.set(key, { ...value });
    if (this.crash) {
      this.crash = false;
      throw new Error("simulated crash after PUT");
    }
  }
}
const git = (root: string, args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
function setup() {
  const temp = mkdtempSync(join(tmpdir(), "mory-image-test-")),
    root = join(temp, "repo"),
    remote = join(temp, "remote.git");
  mkdirSync(root);
  cpSync(resolve("src"), join(root, "src"), { recursive: true });
  cpSync(resolve(".gitignore"), join(root, ".gitignore"));
  writeFixtureContent(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  git(temp, ["clone", "--bare", root, remote]);
  git(root, ["remote", "add", "origin", remote]);
  const store = new Store(root, join(root, "runtime")),
    r2 = new FakeStorage(),
    assets = new Assets(store, r2),
    publisher = new Publisher(store, {
      remote,
      assets,
      deployment: async () => ({ state: "complete" as const }),
    });
  return {
    temp,
    root,
    store,
    r2,
    assets,
    publisher,
    remote,
    close() {
      store.close();
      rmSync(temp, { recursive: true, force: true });
    },
  };
}
const png = () =>
  sharp({
    create: { width: 12, height: 8, channels: 3, background: "#889977" },
  })
    .png()
    .toBuffer();
const stream = (b: Buffer) =>
  Readable.toWeb(Readable.from([b])) as ReadableStream<Uint8Array>;
const upload = async (
  f: ReturnType<typeof setup>,
  key = "page:home",
  name = "../IMG.jpg",
) => f.assets.upload(key, stream(await png()), name);
async function publish(
  f: ReturnType<typeof setup>,
  key: string,
  action: "publish" | "archive" | "restore" | "delete" = "publish",
) {
  const d = f.store.get(key),
    j = f.publisher.request(key, d.revision, action);
  await f.publisher.idle();
  return f.store.job(j.id);
}
function body(f: ReturnType<typeof setup>, key: string, text: string) {
  const d = f.store.get(key);
  return f.store.save(key, d.revision, { ...d.value, body: text });
}

test("streamed upload validates bytes, generates owner filenames and paths, and stages without touching R2 or draft", async () => {
  const f = setup();
  try {
    const before = f.store.get("page:home");
    const a = await upload(f),
      b = await upload(f);
    assert.ok(managedImage(a.filename));
    assert.notEqual(a.filename, b.filename);
    assert.equal(a.width, 12);
    assert.equal(a.height, 8);
    assert.deepEqual(f.store.get("page:home"), before);
    assert.equal(f.r2.puts, 0);
    const asset = f.assets.get(a.id)!;
    assert.match(asset.original_filename, /_/);
    assert.ok(!("local_path" in a));
    assert.ok(existsSync(f.assets.path(asset)));
    assert.equal(asset.mime_type, "image/png");
    assert.match(asset.r2_key, /^pages\/home\/mory-asset-/);
    const post = f.store.create("post");
    const p = await upload(f, post.key);
    assert.match(f.assets.get(p.id)!.r2_key, new RegExp(`^posts/${post.id}/`));
  } finally {
    f.close();
  }
});
test("unsupported, spoofed SVG, truncated, byte/pixel overflow and interrupted streams leave no final files", async () => {
  const f = setup();
  try {
    for (const bytes of [
      Buffer.from("<svg></svg>"),
      Buffer.from("not an image"),
      (await png()).subarray(0, 32),
    ])
      await assert.rejects(
        f.assets.upload("page:home", stream(bytes), "safe.png"),
      );
    const tiny = new Assets(f.store, f.r2, 20);
    await assert.rejects(
      tiny.upload("page:home", stream(await png()), "x.png"),
      /너무 큽니다/,
    );
    const pixels = new Assets(f.store, f.r2, 1024, 20);
    await assert.rejects(
      pixels.upload("page:home", stream(await png()), "x.png"),
      /픽셀/,
    );
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([137, 80]));
        c.error(new Error("network"));
      },
    });
    await assert.rejects(f.assets.upload("page:home", broken, "x.png"));
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) AS n FROM assets").get() &&
        (f.store.db.prepare("SELECT COUNT(*) AS n FROM assets").get() as any).n,
      0,
    );
    assert.deepEqual(
      readdirSync(join(f.store.runtime, "uploads", ".temporary")),
      [],
    );
  } finally {
    f.close();
  }
});
test("JPEG EXIF stripping preserves pixels, orientation is baked without GPS/EXIF; PNG/WebP/GIF remain same-format", async () => {
  const f = setup();
  try {
    for (const format of ["jpeg", "png", "webp", "gif"] as const) {
      const plain = await sharp({
        create: { width: 20, height: 10, channels: 3, background: "#889977" },
      })
        .toFormat(format)
        .toBuffer();
      const input = join(f.temp, `in.${format}`),
        output = join(f.temp, `out.${format}`);
      writeFileSync(input, plain);
      const result = await sanitizeImage(input, output);
      assert.equal(result.mime, `image/${format}`);
      assert.deepEqual(
        await sharp(plain).raw().toBuffer(),
        await sharp(output).raw().toBuffer(),
      );
    }
    const jpeg = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#889977" },
    })
      .withExif({ IFD0: { Artist: "PRIVATE GPS NAME" } })
      .jpeg()
      .toBuffer();
    const file = join(f.temp, "privacy.jpg"),
      out = join(f.temp, "privacy-clean.jpg");
    writeFileSync(file, jpeg);
    await sanitizeImage(file, out);
    assert.equal((await sharp(out).metadata()).exif, undefined);
    assert.ok(!readFileSync(out).includes(Buffer.from("PRIVATE GPS NAME")));
    assert.deepEqual(
      await sharp(jpeg).raw().toBuffer(),
      await sharp(out).raw().toBuffer(),
    );
    const rotated = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#889977" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    writeFileSync(file, rotated);
    await sanitizeImage(file, out);
    const m = await sharp(out).metadata();
    assert.equal(m.width, 10);
    assert.equal(m.height, 20);
    assert.equal(m.orientation, undefined);
    assert.equal(m.exif, undefined);
    const animated = await sharp(
      Buffer.concat([
        Buffer.alloc(4 * 2 * 3, 64),
        Buffer.alloc(4 * 2 * 3, 192),
      ]),
      { raw: { width: 4, height: 4, channels: 3, pageHeight: 2 } },
    )
      .gif({ loop: 0, delay: [100, 200] })
      .toBuffer();
    const comment = Buffer.from([0x21, 0xfe, 3, 65, 66, 67, 0]);
    const gif = Buffer.concat([
        animated.subarray(0, animated.length - 1),
        comment,
        animated.subarray(-1),
      ]),
      sanitized = stripImageMetadata(gif, "gif");
    const meta = await sharp(sanitized, { animated: true }).metadata();
    assert.equal(meta.pages, 2);
    assert.deepEqual(meta.delay, [100, 200]);
    assert.ok(!sanitized.includes(comment));
  } finally {
    f.close();
  }
});
test("same-origin raw upload API serves content only by ID and rejects traversal and JSON/CORS misuse", async () => {
  const f = setup();
  try {
    const origin = "http://127.0.0.1:40009",
      app = createApp(f.store, f.publisher, origin);
    const request = await app.request(origin + "/api/uploads/page:home", {
      method: "POST",
      headers: {
        host: "127.0.0.1:40009",
        origin,
        "Content-Type": "application/octet-stream",
        "X-File-Name": "..%2f..%2fsecret.png",
      },
      body: await png(),
    });
    assert.equal(request.status, 201);
    const value = (await request.json()) as any;
    assert.ok(!JSON.stringify(value).includes("runtime"));
    const image = await app.request(
      origin + `/api/assets/${value.id}/content`,
      { headers: { host: "127.0.0.1:40009" } },
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(
      (
        await app.request(origin + "/api/uploads/page:home", {
          method: "POST",
          headers: {
            host: "127.0.0.1:40009",
            origin: "https://evil.invalid",
            "Content-Type": "application/octet-stream",
          },
          body: await png(),
        })
      ).status,
      403,
    );
    assert.notEqual(
      (
        await app.request(origin + "/api/assets/%2e%2e/content", {
          headers: { host: "127.0.0.1:40009" },
        })
      ).status,
      200,
    );
  } finally {
    f.close();
  }
});
test("preview chooses staged content, width works in Posts/Home/About, and public managed resolver never uses local fallback", async () => {
  const f = setup();
  try {
    for (const key of [
      "page:home",
      "page:about",
      f.store.list().find((d) => d.kind === "post")!.key,
    ]) {
      const a = await upload(f, key);
      const d = f.store.get(key),
        value = { ...d.value, body: `![[${a.filename}|600]]` };
      assert.match(
        await renderPreview(f.store, key, value, "light"),
        new RegExp(`/api/assets/${a.id}/content`),
      );
      assert.match(
        await renderPreview(f.store, key, value, "dark"),
        /width="600"/,
      );
      const owner = { type: d.kind as "post" | "page", id: d.id };
      assert.ok(
        resolveAssetUrl(a.filename, owner).startsWith(
          "https://img.mory.place/",
        ),
      );
    }
    assert.match(
      resolveAssetUrl("old.png", {
        type: "post",
        id: "01K6F4J0M00000000000000001",
      }),
      /^\/fixtures\/posts/,
    );
  } finally {
    f.close();
  }
});
test("publication extracts only real snapshot embeds, deduplicates, and cleans only after successful content push", async () => {
  const f = setup();
  try {
    const a = await upload(f),
      orphan = await upload(f);
    body(
      f,
      "page:home",
      `![[${a.filename}]]\n![[${a.filename}|600]]\n\n\`![[${orphan.filename}]]\`\n\n\`\`\`text\n![[${orphan.filename}]]\n\`\`\``,
    );
    assert.equal((await publish(f, "page:home")).state, "deploying");
    assert.equal(f.r2.puts, 1);
    const asset = f.assets.get(a.id)!;
    assert.ok(asset.r2_uploaded_at && asset.published_at);
    assert.equal(asset.local_path, null);
    assert.equal(f.assets.get(orphan.id)!.r2_uploaded_at, null);
    assert.match(
      await renderPreview(
        f.store,
        "page:home",
        f.store.get("page:home").value,
        "light",
      ),
      /https:\/\/img.mory.place\/pages\/home/,
    );
    body(f, "page:home", "removed");
    await publish(f, "page:home");
    assert.equal(f.r2.objects.size, 1);
  } finally {
    f.close();
  }
});
test("upload failure commits nothing; R2 success plus rejected Git push retains binaries and reuses object on retry", async () => {
  const f = setup();
  try {
    const a = await upload(f);
    body(f, "page:home", `![[${a.filename}]]`);
    const before = git(f.remote, ["rev-parse", "main"]);
    f.r2.fail = true;
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(git(f.remote, ["rev-parse", "main"]), before);
    assert.ok(f.assets.get(a.id)!.local_path);
    f.r2.fail = false;
    const hook = join(f.remote, "hooks/pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.equal((await publish(f, "page:home")).state, "failed");
    const staged = f.assets.get(a.id)!;
    assert.ok(staged.r2_uploaded_at);
    assert.equal(staged.published_at, null);
    assert.ok(existsSync(f.assets.path(staged)));
    const puts = f.r2.puts;
    rmSync(hook);
    assert.equal((await publish(f, "page:home")).state, "deploying");
    assert.equal(f.r2.puts, puts);
    assert.equal(f.assets.get(a.id)!.local_path, null);
  } finally {
    f.close();
  }
});
test("HEAD recovers a PUT-before-database crash; mismatched remote hash and altered local bytes never overwrite", async () => {
  const f = setup();
  try {
    const a = await upload(f);
    body(f, "page:home", `![[${a.filename}]]`);
    f.r2.crash = true;
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(f.assets.get(a.id)!.r2_uploaded_at, null);
    assert.equal((await publish(f, "page:home")).state, "deploying");
    assert.equal(f.r2.puts, 1);
    const b = await upload(f);
    const asset = f.assets.get(b.id)!;
    f.r2.objects.set(asset.r2_key, {
      sha256: "0".repeat(64),
      size: asset.size_bytes,
      mime: asset.mime_type,
      width: 12,
      height: 8,
    });
    body(f, "page:home", `![[${b.filename}]]`);
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(f.r2.puts, 1);
    f.r2.objects.delete(asset.r2_key);
    writeFileSync(f.assets.path(asset), Buffer.from("tampered"));
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(f.r2.puts, 1);
  } finally {
    f.close();
  }
});
test("foreign owner is rejected; a missing asset DB row is recovered only from the same owner public snapshot and HEAD", async () => {
  const f = setup();
  try {
    const a = await upload(f, "page:about");
    body(f, "page:home", `![[${a.filename}]]`);
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(f.r2.puts, 0);
    body(f, "page:about", `![[${a.filename}]]`);
    await publish(f, "page:about");
    f.store.db.prepare("DELETE FROM assets WHERE id=?").run(a.id);
    assert.match(
      await renderPreview(
        f.store,
        "page:about",
        f.store.get("page:about").value,
        "light",
      ),
      /https:\/\/img.mory.place\/pages\/about/,
    );
    body(f, "page:about", `## changed\n![[${a.filename}]]`);
    assert.equal((await publish(f, "page:about")).state, "deploying");
    assert.equal(f.r2.puts, 1);
    assert.ok(f.assets.get(a.id)!.published_at);
    const unknown = "mory-asset-01K6F4J0M000000000000000ZZ.png";
    body(f, "page:home", `![[${unknown}]]`);
    assert.equal((await publish(f, "page:home")).state, "failed");
    assert.equal(f.r2.puts, 1);
  } finally {
    f.close();
  }
});
test("Archive/Restore use public A, preserve unposted Aprime and its image, and delete never removes public R2 objects", async () => {
  const f = setup();
  try {
    let post = f.store
      .list()
      .find((d) => d.kind === "post" && d.value.data.status === "published")!;
    const key = post.key;
    const old = await upload(f, key);
    body(f, key, `public A\n![[${old.filename}]]`);
    await publish(f, key);
    post = f.store.get(key);
    const staged = await upload(f, key);
    body(f, key, `draft Aprime\n![[${staged.filename}]]`);
    const puts = f.r2.puts;
    assert.equal((await publish(f, key, "archive")).state, "deploying");
    post = f.store.get(key);
    assert.match(post.value.body, /Aprime/);
    assert.match(post.published!.body, /public A/);
    assert.doesNotMatch(post.published!.body, /Aprime/);
    assert.equal(f.r2.puts, puts);
    await publish(f, key, "restore");
    post = f.store.get(key);
    assert.equal(post.status, "수정 중");
    assert.match(post.value.body, /Aprime/);
    assert.equal(f.assets.get(staged.id)!.r2_uploaded_at, null);
    await publish(f, key, "archive");
    await publish(f, key, "delete");
    assert.equal(f.r2.objects.size, 1);
    assert.ok(f.assets.get(old.id));
    assert.equal(f.assets.get(staged.id), undefined);
  } finally {
    f.close();
  }
});
test("staged backup uses one hash blob across dates and restores missing binary without replacing existing files", async () => {
  const f = setup();
  try {
    const a = await upload(f);
    const asset = f.assets.get(a.id)!;
    await backup(f.store, new Date("2026-10-01T12:00:00Z"));
    await backup(f.store, new Date("2026-10-02T12:00:00Z"));
    const blobs = join(f.store.runtime, "backups", "assets");
    assert.deepEqual(readdirSync(blobs), [asset.sha256]);
    rmSync(f.assets.path(asset));
    restoreStagedAssets(f.store);
    assert.ok(existsSync(f.assets.path(asset)));
    assert.equal(
      createHash("sha256")
        .update(readFileSync(f.assets.path(asset)))
        .digest("hex"),
      asset.sha256,
    );
    body(f, "page:home", `![[${a.filename}]]`);
    await publish(f, "page:home");
    await backup(f.store, new Date("2026-10-03T12:00:00Z"));
    assert.equal(
      JSON.parse(
        readFileSync(
          join(f.store.runtime, "backups", "2026-10-03.assets.json"),
          "utf8",
        ),
      ).length,
      0,
    );
    assert.ok(existsSync(join(blobs, asset.sha256)));
  } finally {
    f.close();
  }
});
test("CodeMirror anchors map through typing, replacement and independent upload batches", () => {
  let s = EditorState.create({
    doc: "before AFTER",
    extensions: [imageAnchors],
  });
  s = s.update({ effects: addImageAnchor.of({ id: "first", pos: 7 }) }).state;
  s = s.update({ changes: { from: 0, insert: "typed " } }).state;
  assert.equal(s.field(imageAnchors).get("first"), 13);
  s = s.update({ effects: addImageAnchor.of({ id: "second", pos: 0 }) }).state;
  s = s.update({ changes: { from: 6, to: 12, insert: "edited" } }).state;
  assert.equal(s.field(imageAnchors).get("first"), 13);
  assert.equal(s.field(imageAnchors).get("second"), 0);
  s = s.update({ effects: removeImageAnchor.of("first") }).state;
  assert.equal(s.field(imageAnchors).has("first"), false);
});

test("GPS-bearing EXIF is removed from JPEG/PNG/WebP without recompressing ordinary image pixels", async () => {
  const f = setup();
  try {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const encoded = await sharp({
        create: { width: 16, height: 8, channels: 3, background: "#889977" },
      })
        .withExif({
          IFD0: { Artist: "PRIVATE GPS" },
          IFD3: {
            GPSLatitudeRef: "N",
            GPSLatitude: "37/1 0/1 0/1",
            GPSLongitudeRef: "E",
            GPSLongitude: "127/1 0/1 0/1",
          },
        })
        .toFormat(format)
        .toBuffer();
      const file = join(f.temp, `gps-in.${format}`),
        clean = join(f.temp, `gps-out.${format}`);
      writeFileSync(file, encoded);
      assert.ok((await sharp(encoded).metadata()).exif);
      await sanitizeImage(file, clean);
      assert.equal((await sharp(clean).metadata()).exif, undefined);
      assert.deepEqual(
        await sharp(encoded).raw().toBuffer(),
        await sharp(clean).raw().toBuffer(),
      );
    }
  } finally {
    f.close();
  }
});
test("concurrent upload is bounded and revision/autosave conflicts do not destroy a staged image", async () => {
  const f = setup();
  try {
    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const bytes = await png();
    const pending = f.assets.upload(
      "page:home",
      new ReadableStream<Uint8Array>({
        async start(c) {
          await gate;
          c.enqueue(bytes);
          c.close();
        },
      }),
      "slow.png",
    );
    await assert.rejects(upload(f), (e) => (e as CmsError).status === 429);
    finish();
    const result = await pending;
    const before = f.store.get("page:home");
    body(f, "page:home", "other tab");
    assert.throws(
      () =>
        f.store.save(before.key, before.revision, {
          ...before.value,
          body: `![[${result.filename}]]`,
        }),
      (e) => (e as CmsError).status === 409,
    );
    assert.ok(existsSync(f.assets.path(f.assets.get(result.id)!)));
    assert.equal(f.assets.get(result.id)!.r2_uploaded_at, null);
  } finally {
    f.close();
  }
});
test("publication bookkeeping interruption retains local data and is recovered at startup; cleanup respects backup lock", async () => {
  const f = setup();
  try {
    const a = await upload(f);
    body(f, "page:home", `![[${a.filename}]]`);
    const original = f.assets.published.bind(f.assets);
    f.assets.published = async () => {
      throw new Error("simulate bookkeeping interruption");
    };
    assert.equal((await publish(f, "page:home")).state, "deploying");
    assert.ok(f.assets.get(a.id)!.local_path);
    assert.equal(f.assets.get(a.id)!.published_at, null);
    f.store.backupActive = 1;
    await f.assets.recoverPublications();
    assert.ok(f.assets.get(a.id)!.local_path);
    f.store.backupActive = 0;
    f.assets.published = original;
    await f.assets.recoverPublications();
    assert.ok(f.assets.get(a.id)!.published_at);
    assert.equal(f.assets.get(a.id)!.local_path, null);
  } finally {
    f.close();
  }
});

test("orientation JPEG reencoding keeps high-frequency image quality and format with bounded size impact", async () => {
  const f = setup();
  try {
    const width = 128,
      height = 64,
      pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 3;
        pixels[p] = x * 2;
        pixels[p + 1] = y * 4;
        pixels[p + 2] = (x + y) % 256;
      }
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92 })
      .toBuffer();
    const input = join(f.temp, "orientation.jpg"),
      output = join(f.temp, "oriented.jpg");
    writeFileSync(input, jpeg);
    await sanitizeImage(input, output);
    const expected = await sharp(jpeg).autoOrient().raw().toBuffer(),
      actual = await sharp(output).raw().toBuffer();
    let total = 0,
      max = 0;
    for (let i = 0; i < actual.length; i++) {
      const delta = Math.abs(actual[i] - expected[i]);
      total += delta;
      max = Math.max(max, delta);
    }
    assert(actual.length === expected.length);
    assert(total / actual.length < 1);
    assert(max < 10);
    console.log(
      "Orientation JPEG quality check",
      JSON.stringify({
        meanChannelDelta: Number((total / actual.length).toFixed(3)),
        maxChannelDelta: max,
        inputBytes: jpeg.length,
        outputBytes: readFileSync(output).length,
      }),
    );
  } finally {
    f.close();
  }
});

test("preview reports unknown/missing staged managed files without querying R2", async () => {
  const f = setup();
  try {
    const unknown = "mory-asset-01K6F4J0M000000000000000ZZ.png",
      row = f.store.get("page:home");
    await assert.rejects(
      renderPreview(
        f.store,
        row.key,
        { ...row.value, body: `![[${unknown}]]` },
        "light",
      ),
      /이미지 파일이 없습니다/,
    );
    const staged = await upload(f);
    rmSync(f.assets.path(f.assets.get(staged.id)!));
    await assert.rejects(
      renderPreview(
        f.store,
        row.key,
        { ...row.value, body: `![[${staged.filename}]]` },
        "light",
      ),
      /이미지 파일이 없습니다/,
    );
    assert.equal(f.r2.heads, 0);
  } finally {
    f.close();
  }
});
