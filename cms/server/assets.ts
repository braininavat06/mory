import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { rename, rm, chmod } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ulid } from "ulid";
import {
  ownerKey,
  managedImage,
  managedCandidate,
  resolveAssetUrl,
} from "../../src/lib/assets.ts";
import type { AssetOwner } from "../../src/lib/assets.ts";
import { readContent } from "../../src/lib/content.ts";
import { createMarkdownOptions } from "../../src/markdown/pipeline.ts";
import { CmsError } from "../shared.ts";
import type { Draft, Payload, PublishJob } from "../shared.ts";
import { workspaceTime } from "./store.ts";
import type { Store } from "./store.ts";
import {
  sanitizeImage,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
} from "./image-sanitize.ts";
import { R2Storage } from "./r2.ts";
import type { ImageStorage, RemoteImage } from "./r2.ts";
export interface Asset {
  id: string;
  owner_type: "post" | "page";
  owner_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
  sha256: string;
  local_path: string | null;
  r2_key: string;
  r2_uploaded_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
export function imageOwner(row: Draft): AssetOwner {
  if (row.kind !== "post" && row.kind !== "page")
    throw new CmsError(400, "글과 페이지에만 이미지를 추가할 수 있습니다.");
  return { type: row.kind, id: row.id };
}
function limit(value: string | undefined, fallback: number) {
  const n = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(n) || n <= 0) {
    console.warn("CMS image limit invalid; using default");
    return fallback;
  }
  return n;
}
export class Assets {
  private active = 0;
  constructor(
    public store: Store,
    public remote: ImageStorage = new R2Storage(),
    public maxBytes = limit(process.env.MORY_IMAGE_MAX_BYTES, IMAGE_MAX_BYTES),
    public maxPixels = limit(
      process.env.MORY_IMAGE_MAX_PIXELS,
      IMAGE_MAX_PIXELS,
    ),
  ) {}
  get(id: string) {
    return this.store.db.prepare("SELECT * FROM assets WHERE id=?").get(id) as
      Asset | undefined;
  }
  find(owner: AssetOwner, filename: string) {
    return this.store.db
      .prepare(
        "SELECT * FROM assets WHERE owner_type=? AND owner_id=? AND filename=?",
      )
      .get(owner.type, owner.id, filename) as Asset | undefined;
  }
  path(asset: Asset) {
    if (!asset.local_path)
      throw new CmsError(404, "저장된 이미지 파일이 없습니다.");
    const file = resolve(this.store.runtime, asset.local_path),
      root = resolve(this.store.runtime, "uploads");
    if (!file.startsWith(root + sep))
      throw new CmsError(400, "이미지 저장 경로를 확인할 수 없습니다.");
    return file;
  }
  private add(asset: Asset) {
    this.store.db
      .prepare(
        `INSERT INTO assets (id,owner_type,owner_id,filename,original_filename,mime_type,size_bytes,width,height,sha256,local_path,r2_key,r2_uploaded_at,published_at,created_at,updated_at) VALUES (@id,@owner_type,@owner_id,@filename,@original_filename,@mime_type,@size_bytes,@width,@height,@sha256,@local_path,@r2_key,@r2_uploaded_at,@published_at,@created_at,@updated_at)`,
      )
      .run(asset);
  }
  async upload(
    key: string,
    body: ReadableStream<Uint8Array> | null,
    originalName: string,
  ) {
    const row = this.store.get(key),
      owner = imageOwner(row);
    if (!body) throw new CmsError(400, "이미지 파일이 없습니다.");
    if (this.active >= 1) {
      await body.cancel().catch(() => {});
      throw new CmsError(
        429,
        "이미지를 처리 중입니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    this.active++;
    const id = ulid(),
      dir = join(this.store.runtime, "uploads", ".temporary");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const incoming = join(dir, `${id}.incoming`),
      clean = join(dir, `${id}.clean`);
    let final: string | undefined;
    try {
      let size = 0;
      await pipeline(
        Readable.fromWeb(body as any),
        new Transform({
          transform: (chunk, _encoding, next) => {
            size += chunk.length;
            next(
              size > this.maxBytes
                ? new CmsError(
                    413,
                    `이미지가 너무 큽니다. 최대 ${Math.floor(this.maxBytes / 1024 / 1024)} MiB입니다.`,
                  )
                : null,
              chunk,
            );
          },
        }),
        createWriteStream(incoming, { flags: "wx", mode: 0o600 }),
      );
      const image = await sanitizeImage(incoming, clean, this.maxPixels);
      if (statSync(clean).size > this.maxBytes)
        throw new CmsError(413, "메타데이터 처리 후 이미지가 너무 큽니다.");
      // Owner may have been deleted during decoding; never resurrect its assets.
      this.store.get(key);
      const filename = `mory-asset-${id}.${image.extension}`,
        r2key = ownerKey(owner, filename);
      final = join(this.store.runtime, "uploads", r2key);
      mkdirSync(join(final, ".."), { recursive: true, mode: 0o700 });
      await chmod(clean, 0o600);
      await rename(clean, final);
      const now = workspaceTime(),
        asset: Asset = {
          id,
          owner_type: owner.type,
          owner_id: owner.id,
          filename,
          original_filename: originalName
            .replace(/[\x00-\x1f\x7f\\/]/g, "_")
            .slice(0, 255),
          mime_type: image.mime,
          size_bytes: statSync(final).size,
          width: image.width,
          height: image.height,
          sha256: createHash("sha256")
            .update(readFileSync(final))
            .digest("hex"),
          local_path: relative(this.store.runtime, final),
          r2_key: r2key,
          r2_uploaded_at: null,
          published_at: null,
          created_at: now,
          updated_at: now,
        };
      this.add(asset);
      return { id, filename, width: asset.width, height: asset.height };
    } catch (error) {
      if (final) await rm(final, { force: true });
      if (error instanceof CmsError) throw error;
      throw new CmsError(
        400,
        "이미지 업로드에 실패했습니다. 파일과 연결을 확인해 주세요.",
      );
    } finally {
      await Promise.allSettled([
        rm(incoming, { force: true }),
        rm(clean, { force: true }),
      ]);
      this.active--;
    }
  }
  preview(filename: string, owner?: AssetOwner, published = new Set<string>()) {
    if (!managedImage(filename)) return resolveAssetUrl(filename, owner);
    if (!owner)
      throw new CmsError(400, "이미지 소유 문서를 확인할 수 없습니다.");
    const asset = this.find(owner, filename);
    if (asset?.local_path && existsSync(this.path(asset)))
      return `/api/assets/${asset.id}/content`;
    if (asset?.r2_uploaded_at) return resolveAssetUrl(filename, owner);
    // Public references remain viewable after restoring an old SQLite backup.
    if (published.has(filename)) return resolveAssetUrl(filename, owner);
    throw new CmsError(
      400,
      "미리보기 이미지 파일이 없습니다. 이 문서에 이미지를 다시 업로드해 주세요.",
    );
  }
  async references(row: Draft, payload: Payload, root = this.store.root) {
    const content = readContent(root);
    if (row.kind === "post")
      content.posts = [
        ...content.posts.filter((p) => p.data.id !== row.id),
        { file: row.path, data: payload.data as any, body: payload.body },
      ];
    else if (row.kind === "page")
      content.pages = [
        ...content.pages.filter((p) => p.key !== row.id),
        {
          file: row.path,
          key: row.id,
          data: payload.data as any,
          body: payload.body,
        },
      ];
    const names = new Set<string>();
    const options = createMarkdownOptions(content, [], undefined, {
      onEmbed: (filename) => {
        if (managedCandidate(filename)) {
          if (!managedImage(filename))
            throw new CmsError(400, "잘못된 CMS 이미지 파일명입니다.");
          names.add(filename);
        }
      },
    });
    const renderer = await options.processor.createRenderer(options);
    await renderer.render(payload.body, {
      fileURL: pathToFileURL(resolve(root, row.path)),
      frontmatter: payload.data,
    });
    return [...names];
  }
  private matches(asset: Asset, object: RemoteImage) {
    return (
      asset.sha256 === object.sha256 &&
      asset.size_bytes === object.size &&
      asset.mime_type === object.mime
    );
  }
  async prepare(row: Draft, payload: Payload, root: string) {
    const owner = imageOwner(row),
      names = await this.references(row, payload, root);
    let publishedNames: string[] | undefined;
    for (const filename of names) {
      let asset = this.find(owner, filename);
      if (!asset) {
        const other = this.store.db
          .prepare("SELECT owner_id FROM assets WHERE filename=?")
          .get(filename);
        if (other)
          throw new CmsError(
            400,
            "다른 글이나 페이지의 이미지는 사용할 수 없습니다.",
          );
        publishedNames ??= row.published
          ? await this.references(row, row.published, root)
          : [];
        if (!publishedNames.includes(filename))
          throw new CmsError(
            400,
            "이 문서에 업로드한 이미지가 아닙니다. 이미지를 다시 선택해 주세요.",
          );
        const key = ownerKey(owner, filename),
          object = await this.remote.head(key);
        if (
          !object ||
          !/^[a-f0-9]{64}$/.test(object.sha256) ||
          !object.width ||
          !object.height ||
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            object.mime,
          )
        )
          throw new CmsError(
            400,
            "게시된 이미지를 저장소에서 복구할 수 없습니다.",
          );
        const now = workspaceTime();
        asset = {
          id: filename.slice(11, 37),
          owner_type: owner.type,
          owner_id: owner.id,
          filename,
          original_filename: "",
          mime_type: object.mime,
          size_bytes: object.size,
          width: object.width,
          height: object.height,
          sha256: object.sha256,
          local_path: null,
          r2_key: key,
          r2_uploaded_at: now,
          published_at: now,
          created_at: now,
          updated_at: now,
        };
        this.add(asset);
      }
      if (asset.r2_key !== ownerKey(owner, filename))
        throw new CmsError(400, "이미지의 소유 문서와 저장 주소가 다릅니다.");
      let file: string | undefined;
      if (asset.local_path && existsSync(this.path(asset))) {
        file = this.path(asset);
        const sha = createHash("sha256")
          .update(readFileSync(file))
          .digest("hex");
        if (sha !== asset.sha256 || statSync(file).size !== asset.size_bytes)
          throw new CmsError(
            400,
            "저장된 이미지가 원본과 다릅니다. 이미지를 다시 업로드해 주세요.",
          );
      }
      let object = await this.remote.head(asset.r2_key);
      if (object && !this.matches(asset, object))
        throw new CmsError(
          400,
          "같은 이미지 주소에 다른 파일이 있습니다. 덮어쓰지 않았습니다. 새 이미지를 업로드해 주세요.",
        );
      if (!object) {
        if (!file)
          throw new CmsError(
            400,
            "이미지 파일이 없습니다. 이미지를 다시 업로드해 주세요.",
          );
        await this.remote.put(asset.r2_key, file, {
          sha256: asset.sha256,
          size: asset.size_bytes,
          mime: asset.mime_type,
          width: asset.width,
          height: asset.height,
        });
        const uploaded = workspaceTime();
        this.store.db
          .prepare(
            "UPDATE assets SET r2_uploaded_at=COALESCE(r2_uploaded_at,?),updated_at=? WHERE id=?",
          )
          .run(uploaded, uploaded, asset.id);
        object = await this.remote.head(asset.r2_key);
        if (!object || !this.matches(asset, object))
          throw new CmsError(
            502,
            "이미지 업로드를 확인하지 못했습니다. 작업본과 이미지 파일은 보존됩니다.",
          );
      }
      const now = workspaceTime();
      this.store.db
        .prepare(
          "UPDATE assets SET r2_uploaded_at=COALESCE(r2_uploaded_at,?),updated_at=? WHERE id=?",
        )
        .run(now, now, asset.id);
    }
    return names;
  }
  async published(row: Draft, job: PublishJob, root: string) {
    if (job.action !== "publish" || !["post", "page"].includes(row.kind))
      return;
    const names = await this.references(row, job.snapshot, root),
      owner = imageOwner(row),
      now = workspaceTime();
    this.store.db.transaction(() => {
      for (const name of names)
        this.store.db
          .prepare(
            "UPDATE assets SET published_at=COALESCE(published_at,?),updated_at=? WHERE owner_type=? AND owner_id=? AND filename=? AND r2_uploaded_at IS NOT NULL",
          )
          .run(now, now, owner.type, owner.id, name);
    })();
    this.cleanup();
  }
  async recoverPublications() {
    for (const row of this.store
      .list()
      .filter((d) => ["post", "page"].includes(d.kind) && d.published)) {
      try {
        const names = await this.references(row, row.published!);
        const owner = imageOwner(row),
          now = workspaceTime();
        for (const name of names)
          this.store.db
            .prepare(
              "UPDATE assets SET published_at=COALESCE(published_at,?),updated_at=? WHERE owner_type=? AND owner_id=? AND filename=? AND r2_uploaded_at IS NOT NULL",
            )
            .run(now, now, owner.type, owner.id, name);
      } catch {
        console.warn("CMS image publication recovery deferred");
      }
    }
    this.cleanup();
  }
  cleanup() {
    if (this.store.backupActive) return;
    for (const asset of this.store.db
      .prepare(
        "SELECT * FROM assets WHERE owner_type='post' AND r2_uploaded_at IS NULL AND NOT EXISTS (SELECT 1 FROM drafts WHERE kind='post' AND id=assets.owner_id)",
      )
      .all() as Asset[]) {
      try {
        if (asset.local_path) rmSync(this.path(asset), { force: true });
        this.store.db.prepare("DELETE FROM assets WHERE id=?").run(asset.id);
      } catch {
        console.warn("CMS orphan staged image cleanup deferred");
      }
    }
    for (const asset of this.store.db
      .prepare(
        "SELECT * FROM assets WHERE published_at IS NOT NULL AND r2_uploaded_at IS NOT NULL AND local_path IS NOT NULL",
      )
      .all() as Asset[]) {
      try {
        rmSync(this.path(asset), { force: true });
        this.store.db
          .prepare("UPDATE assets SET local_path=NULL WHERE id=?")
          .run(asset.id);
      } catch {
        console.warn("CMS published image cleanup deferred");
      }
    }
  }
  deleteStaged(row: Draft) {
    if (row.kind !== "post" || this.store.backupActive) return;
    for (const asset of this.store.db
      .prepare(
        "SELECT * FROM assets WHERE owner_type=? AND owner_id=? AND r2_uploaded_at IS NULL",
      )
      .all("post", row.id) as Asset[]) {
      try {
        if (asset.local_path) rmSync(this.path(asset), { force: true });
        this.store.db.prepare("DELETE FROM assets WHERE id=?").run(asset.id);
      } catch {
        console.warn("CMS staged image cleanup deferred");
      }
    }
  }
}
