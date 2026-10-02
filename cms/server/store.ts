import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { readContent } from '../../src/lib/content.ts';
import { publicationTime } from '../../src/lib/dates.ts';
import { routeId, ulid as idSchema } from '../../src/lib/schema.ts';
import { CmsError, categoryReferences } from '../shared.ts';
import type { Draft, Kind, Payload, PublishJob, LocalSync } from '../shared.ts';
import { assertRuntimeLocation } from './config.ts';

export function workspaceTime() { const now = new Date(); return publicationTime(now).replace('+09:00', `.${String(now.getUTCMilliseconds()).padStart(3, '0')}+09:00`); }
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function fileHash(root: string, path: string): string | null {
  return existsSync(join(root, path)) ? hash(readFileSync(join(root, path), 'utf8')) : null;
}
export const equal = (a: unknown, b: unknown): boolean => {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
};
export class Store {
  db: Database.Database;
  backupActive = 0;
  constructor(public root: string, public runtime: string) {
    assertRuntimeLocation(root, runtime);
    mkdirSync(runtime, { recursive: true, mode: 0o700 }); chmodSync(runtime, 0o700);
    this.db = new Database(join(runtime, 'cms.sqlite')); chmodSync(join(runtime, 'cms.sqlite'), 0o600);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS drafts (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL,
      value TEXT NOT NULL, published TEXT, base_hash TEXT, ever_published INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, saved_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_jobs (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL,
      snapshot TEXT NOT NULL, state TEXT NOT NULL, pushed_at TEXT, commit_sha TEXT, error TEXT, run_url TEXT,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(key, revision, action));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
        filename TEXT NOT NULL UNIQUE, original_filename TEXT NOT NULL, mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, sha256 TEXT NOT NULL,
        local_path TEXT, r2_key TEXT NOT NULL UNIQUE, r2_uploaded_at TEXT, published_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner_type,owner_id);`);
    if (!(this.db.pragma('table_info(publish_jobs)') as {name:string}[]).some(c => c.name === 'pushed_at')) this.db.exec('ALTER TABLE publish_jobs ADD COLUMN pushed_at TEXT');
    if (!this.db.prepare("SELECT 1 FROM settings WHERE key = 'imported'").get()) this.import();
  }
  import() {
    const content = readContent(this.root);
    this.db.transaction(() => {
      for (const p of content.posts) this.insert('post', p.data.id, p.file, { data: p.data, body: p.body }, true, !!p.data.publishedAt);
      for (const p of content.pages) this.insert('page', p.key, p.file, { data: p.data, body: p.body }, true, true);
      this.insert('categories', 'registry', 'src/data/categories.yaml', { data: content.categories, body: '' }, true, true);
      for (const [id, data] of Object.entries(content.series)) this.insert('series', id, `data/series/${id}.yaml`, { data: { id, ...data }, body: '' }, true, true);
      this.db.prepare('INSERT INTO settings VALUES (?, ?)').run('imported', publicationTime());
    })();
  }
  insert(kind: Kind, id: string, path: string, value: Payload, imported = false, ever = false): Draft {
    const now = workspaceTime();
    this.db.prepare('INSERT INTO drafts (key,kind,id,path,value,published,base_hash,ever_published,saved_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(`${kind}:${id}`, kind, id, path, JSON.stringify(value), imported ? JSON.stringify(value) : null, imported ? fileHash(this.root, path) : null, +ever, now, now);
    return this.get(`${kind}:${id}`);
  }
  decode(raw: any): Draft {
    if (!raw) throw new CmsError(404, '문서를 찾지 못했습니다.');
    const value: Payload = JSON.parse(raw.value); const published = raw.published ? JSON.parse(raw.published) : null;
    const status = value.data.status === 'archived' ? '보관됨' : !raw.ever_published && raw.kind === 'post' ? '초안' : equal(value, published) ? '게시됨' : '수정 중';
    return { ...raw, value, published, ever_published: !!raw.ever_published, status };
  }
  get(key: string): Draft { return this.decode(this.db.prepare('SELECT * FROM drafts WHERE key=?').get(key)); }
  list(): Draft[] { return this.db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC, rowid DESC').all().map(r => this.decode(r)); }
  create(kind: 'post' | 'series', id?: string): Draft {
    if (kind === 'post') {
      const postId = ulid(); const category = Object.keys(this.get('categories:registry').published?.data ?? {})[0] ?? '';
      return this.insert(kind, postId, `src/content/posts/${postId}.md`, { data: { id: postId, title: '', slug: '', category, status: 'draft', description: '', aliases: [] }, body: '' });
    }
    const seriesId = routeId.parse(id);
    if (this.list().some(d => d.kind === 'series' && d.id === seriesId)) throw new CmsError(409, '이미 사용 중인 시리즈 ID입니다.');
    return this.insert(kind, seriesId, `data/series/${seriesId}.yaml`, { data: { id: seriesId, name: '', description: '', posts: [] }, body: '' });
  }
  save(key: string, revision: number, value: Payload, slugChange = false): Draft {
    return this.db.transaction(() => {
      const row = this.get(key);
      if (row.revision !== revision) throw new CmsError(409, '서버 최신본이 따로 있습니다. 미저장 내용을 보존하고 자동저장을 멈췄습니다.');
      if (this.db.prepare("SELECT 1 FROM publish_jobs WHERE key=? AND state='publishing'").get(key)) throw new CmsError(423, '게시 내용을 확정하는 중입니다. 잠시 후 다시 저장하세요.');
      if (!value || typeof value.body !== 'string' || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new CmsError(400, '잘못된 문서 형식입니다.');
      if (value.deleted) throw new CmsError(400, '문서 삭제는 삭제 버튼으로 처리하세요.');
      value = structuredClone(value);
      if (row.kind === 'post') {
        if (value.data.id !== row.id) throw new CmsError(400, '글 ID는 변경할 수 없습니다.');
        idSchema.parse(value.data.id);
        if (value.data.status !== row.value.data.status) throw new CmsError(400, '공개 상태는 게시·보관·복원 버튼으로 변경하세요.');
        if (value.data.category && !Object.hasOwn(this.get('categories:registry').published?.data ?? {}, value.data.category)) throw new CmsError(400, '게시된 분류만 선택할 수 있습니다.');
        if (row.ever_published && value.data.slug !== row.value.data.slug) {
          if (!slugChange) throw new CmsError(400, '게시된 주소 변경을 명시적으로 선택하세요.');
          // Autosaved intermediate slugs were never public. Preserve only the
          // last published address, and remove an alias becoming active again.
          value.data.aliases = (value.data.aliases ?? []).filter((alias: string) => alias !== value.data.slug);
        }
        if (row.ever_published && row.published?.data.slug !== value.data.slug) value.data.aliases = [...new Set([...(value.data.aliases ?? []), row.published?.data.slug].filter(Boolean))];
      }
      if (row.kind === 'series' && value.data.id !== row.id) throw new CmsError(400, '시리즈 ID는 변경할 수 없습니다.');
      if (row.kind === 'categories') this.assertCategoriesDeletedSafely(row.value.data, value.data);
      const now = workspaceTime();
      const changed = this.db.prepare('UPDATE drafts SET value=?,revision=revision+1,saved_at=?,updated_at=? WHERE key=? AND revision=?').run(JSON.stringify(value), now, now, key, revision);
      if (!changed.changes) throw new CmsError(409, '다른 창에서 저장한 내용이 있습니다.');
      return this.get(key);
    })();
  }
  assertCategoriesDeletedSafely(before: Record<string, any>, after: Record<string, any>) {
    for (const id of Object.keys(before).filter(id => !Object.hasOwn(after, id))) {
      const references = categoryReferences(this.list(), id);
      if (references.length) throw new CmsError(400, `이 분류를 사용하는 글 ${references.length}개가 있어 삭제할 수 없습니다: ${references.slice(0, 5).map(d => `${d.title} (${d.source})`).join(', ')}. 초안·보관된 글도 포함됩니다. 글을 다른 분류로 옮기고, 공개본에서 사용하는 분류도 변경사항을 게시해 반영해 주세요.`);
    }
  }
  removePostReferences(id: string) {
    for (const draft of this.list().filter(d => d.kind === 'series' && d.value.data.posts?.includes(id))) {
      draft.value.data.posts = draft.value.data.posts.filter((p: string) => p !== id);
      const now = workspaceTime();
      this.db.prepare('UPDATE drafts SET value=?,revision=revision+1,saved_at=?,updated_at=? WHERE key=?').run(JSON.stringify(draft.value), now, now, draft.key);
    }
  }
  jobs(): PublishJob[] { return this.db.prepare('SELECT * FROM publish_jobs ORDER BY started_at DESC, rowid DESC').all().map((r: any) => ({ ...r, snapshot: JSON.parse(r.snapshot) })); }
  job(id: string): PublishJob { const job = this.jobs().find(j => j.id === id); if (!job) throw new CmsError(404, '게시 작업을 찾지 못했습니다.'); return job; }
  updateJob(id: string, patch: Partial<PublishJob>) {
    const allowed = ['state', 'pushed_at', 'commit_sha', 'error', 'run_url', 'snapshot'] as const;
    const keys = allowed.filter(k => k in patch);
    this.db.prepare(`UPDATE publish_jobs SET ${keys.map(k => `${k}=?`).join(',')},updated_at=? WHERE id=?`).run(...keys.map(k => k === 'snapshot' ? JSON.stringify(patch[k]) : patch[k] ?? null), publicationTime(), id);
  }
  localSync(): LocalSync | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='local-sync'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  setLocalSync(state: LocalSync) {
    this.db.prepare("INSERT INTO settings (key,value) VALUES ('local-sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(state));
  }
  close() { this.db.close(); }
}
