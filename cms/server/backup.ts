import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  renameSync,
  chmodSync,
  linkSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { publicationTime } from "../../src/lib/dates.ts";
import { lifecycle, lifecycleSync } from "./lifecycle-lock.ts";
import type { Store } from "./store.ts";
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function linkOrCopy(from: string, to: string) {
  try {
    linkSync(from, to);
  } catch (error: any) {
    if (error.code === "EEXIST") return;
    copyFileSync(from, to);
  }
  chmodSync(to, 0o600);
}
export async function backup(store: Store, now = new Date(), options: { manual?: boolean } = {}) {
  return lifecycle(store.runtime, () => takeBackup(store, now, options));
}
async function takeBackup(store: Store, now: Date, options: { manual?: boolean }) {
  const dir = join(store.runtime, "backups"),
    blobs = join(dir, "assets");
  mkdirSync(blobs, { recursive: true, mode: 0o700 });
  // All backup processes hold the same OS lock. Remaining partials can only be
  // from a crashed process, never from a live concurrent backup.
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.partial'))) rmSync(join(dir,name),{force:true});
  const day = publicationTime(now).slice(0, 10),
    stem = options.manual ? `${day}-manual-${now.getTime()}-${randomUUID().slice(0,8)}` : day,
    target = join(dir, `${stem}.sqlite`),
    manifest = join(dir, `${stem}.assets.json`);
  store.backupActive++;
  try {
    if (options.manual || !existsSync(target)) {
      const temporary = `${target}.partial`;
      rmSync(temporary, { force: true });
      await store.db.backup(temporary);
      chmodSync(temporary, 0o600);
      const snapshot = new Database(temporary, { readonly: true });
      try {
        const assets = snapshot
          .prepare(
            "SELECT id,sha256,local_path FROM assets WHERE local_path IS NOT NULL",
          )
          .all() as { id: string; sha256: string; local_path: string }[];
        for (const asset of assets) {
          const file = resolve(store.runtime, asset.local_path);
          if (
            !file.startsWith(resolve(store.runtime, "uploads") + sep) ||
            sha(file) !== asset.sha256
          )
            throw new Error("미게시 이미지 백업 파일을 확인할 수 없습니다.");
          const blob = join(blobs, asset.sha256);
          if (!existsSync(blob)) linkOrCopy(file, blob);
          if (sha(blob) !== asset.sha256)
            throw new Error("이미지 백업 무결성 검사에 실패했습니다.");
        }
        writeFileSync(
          `${manifest}.partial`,
          JSON.stringify(assets.map((a) => ({ id: a.id, sha256: a.sha256 }))),
          { mode: 0o600 },
        );
        renameSync(`${manifest}.partial`, manifest);
        renameSync(temporary, target);
      } finally {
        snapshot.close();
      }
    }
    const keptWeeks = new Set<number>(),
      cutoff = Date.parse(`${day}T00:00:00Z`);
    for (const name of readdirSync(dir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}(?:-manual-\d+-[a-f0-9]+)?\.sqlite$/.test(n))
      .sort()
      .reverse()) {
      const age = Math.floor(
        (cutoff - Date.parse(`${name.slice(0, 10)}T00:00:00Z`)) / 86400_000,
      );
      if (age < 7) continue;
      const week = Math.floor(Date.parse(name.slice(0, 10)) / (7 * 86400_000));
      if (age <= 63 && !keptWeeks.has(week)) keptWeeks.add(week);
      else {
        rmSync(join(dir, name));
        rmSync(join(dir, name.replace(".sqlite", ".assets.json")), { force: true });
      }
    }
    const live = new Set<string>();
    for (const name of readdirSync(dir).filter(
      (n) =>
        /\.assets\.json$/.test(n) &&
        existsSync(join(dir, n.replace(".assets.json", ".sqlite"))),
    ))
      for (const asset of JSON.parse(readFileSync(join(dir, name), "utf8")))
        live.add(asset.sha256);
    for (const name of readdirSync(blobs))
      if (/^[a-f0-9]{64}$/.test(name) && !live.has(name))
        rmSync(join(blobs, name));
    return target;
  } finally {
    rmSync(`${target}.partial`, { force: true });
    rmSync(`${manifest}.partial`, { force: true });
    if (!existsSync(target)) rmSync(manifest, { force: true });
    store.backupActive--;
  }
}
// When restoring cms.sqlite, missing staged binaries can be recovered from the
// content-addressed backup. Never replace an existing file or invent a DB row.
export function restoreStagedAssets(store: Store) { return lifecycleSync(store.runtime, () => restoreAssets(store)); }
function restoreAssets(store: Store) {
  for (const asset of store.db
    .prepare(
      "SELECT sha256,local_path FROM assets WHERE local_path IS NOT NULL AND published_at IS NULL",
    )
    .all() as { sha256: string; local_path: string }[]) {
    const file = resolve(store.runtime, asset.local_path),
      blob = join(store.runtime, "backups", "assets", asset.sha256);
    if (
      !file.startsWith(resolve(store.runtime, "uploads") + sep) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      existsSync(file) ||
      !existsSync(blob)
    )
      continue;
    if (sha(blob) !== asset.sha256) {
      console.warn("CMS image backup recovery integrity check failed");
      continue;
    }
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    linkOrCopy(blob, file);
  }
}
