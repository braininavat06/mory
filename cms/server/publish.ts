import { lifecycle } from './lifecycle-lock.ts';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { stringify } from 'yaml';
import { ulid } from 'ulid';
import { readContent } from '../../src/lib/content.ts';
import { validateMarkdown } from '../../src/lib/validate-markdown.ts';
import { publicationTime } from '../../src/lib/dates.ts';
import { Store, fileHash, equal, workspaceTime } from './store.ts';
import { CmsError } from '../shared.ts';
import type { Action, Draft, Payload, PublishJob, LocalSync } from '../shared.ts';
import { gitOutput } from './git.ts';
import { DevSync, remoteIdentity } from './dev-sync.ts';
import { Assets } from './assets.ts';
import { managedContent } from './content-paths.ts';
import { postSlugWarning } from '../slug.ts';
import { CONTENT_CONTRACT_VERSION } from '../../src/lib/content-contract.ts';
export interface PublisherOptions { remote: string; deploymentIntervalMs?: number; branch?: string; author?: string; email?: string; assets?: Assets; retryDeployment?: (url: string) => Promise<void>; deployment?: (sha: string) => Promise<{ state: 'deploying' | 'complete' | 'superseded' | 'failed'; url?: string; error?: string }> }
export class Publisher {
  private queue: Promise<void> = Promise.resolve();
  private lastChecked = new Map<string, number>();
  private checking = new Set<string>();
  private retrying = new Map<string, Promise<PublishJob>>();
  private running = new Set<string>();
  private deployingCode = false;
  get gitBusy() { return this.deployingCode || this.running.size > 0 || this.otherGitTasks > 0; }
  private otherGitTasks = 0;
  async deployExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.gitBusy) throw new CmsError(423, '콘텐츠 게시 또는 다른 Git 작업이 진행 중입니다. 완료 후 다시 배포하세요.');
    this.deployingCode = true;
    const task = this.queue.then(operation);
    this.queue = task.then(() => {}, () => {});
    try { return await task; } finally { this.deployingCode = false; }
  }
  assets: Assets;
  repo: string;
  dev: DevSync;
  constructor(public store: Store, public options: PublisherOptions) {
    this.assets = options.assets ?? new Assets(store);
    this.repo = join(store.runtime, 'publish-repo');
    this.dev = new DevSync(store, options.remote, options.branch, (sha, cwd) => this.compatible(sha, cwd));
  }
  async git(args: string[], cwd = this.repo): Promise<string> {
    return (await gitOutput(args, cwd)).trim();
  }
  request(key: string, revision: number, action: Action = 'publish'): PublishJob {
    if (this.deployingCode) throw new CmsError(423, 'Mory 변경사항을 반영하는 중입니다. 완료 후 콘텐츠를 게시하세요.');
    const existing = this.store.jobs().find(j => j.key === key && j.revision === revision && j.action === action);
    if (existing) {
      if (existing.state === 'publishing' || (!existing.pushed_at && !['complete', 'deploying'].includes(existing.state))) this.enqueue(existing.id);
      return this.store.job(existing.id);
    }
    const row = this.store.get(key);
    if (row.revision !== revision) throw new CmsError(409, '현재 저장된 내용이 바뀌었습니다. 다시 확인한 뒤 게시하세요.');
    if (row.kind === 'post' && action === 'publish') {
      const warning = postSlugWarning(row.value.data.slug, row.id, this.store.list());
      if (warning) throw new CmsError(400, warning);
    }
    if (this.store.jobs().some(j => j.key === key && j.state === 'publishing')) throw new CmsError(423, '이 문서를 게시하는 중입니다.');
    if (row.kind === 'page' && action !== 'publish') throw new CmsError(400, '일반 페이지는 보관하거나 삭제할 수 없습니다.');
    if (action === 'delete' && row.kind === 'post' && row.value.data.status !== 'archived') throw new CmsError(400, '보관된 글만 영구 삭제할 수 있습니다.');
    if (action !== 'publish' && action !== 'delete' && row.kind !== 'post') throw new CmsError(400, '글에만 사용할 수 있는 동작입니다.');
    if (action === 'restore' && row.value.data.status !== 'archived') throw new CmsError(400, '보관된 글만 복원할 수 있습니다.');
    const snapshot = structuredClone(row.kind === 'post' && row.published && ['archive', 'restore'].includes(action) ? row.published : row.value);
    if (row.kind === 'post') {
      if (action === 'delete') snapshot.deleted = true;
      else if (action === 'archive') snapshot.data.status = 'archived';
      else if (action === 'restore') snapshot.data.status = row.ever_published ? 'published' : 'draft';
      else {
        if (snapshot.data.status === 'archived') throw new CmsError(400, '보관된 글을 먼저 복원하세요.');
        snapshot.data.status = 'published';
      }
      if (action === 'publish' && snapshot.data.status === 'published') {
        if (!snapshot.data.publishedAt) snapshot.data.publishedAt = publicationTime();
        if (row.ever_published && equal(snapshot.data.updatedAt, row.published?.data.updatedAt)) snapshot.data.updatedAt = publicationTime();
      }
    }
    if (action === 'delete') snapshot.deleted = true;
    const id = ulid(), now = publicationTime();
    this.store.db.prepare('INSERT INTO publish_jobs (id,key,revision,action,snapshot,state,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, key, revision, action, JSON.stringify(snapshot), 'publishing', now, now);
    this.enqueue(id); return this.store.job(id);
  }
  enqueue(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    this.store.updateJob(id, { state: 'publishing', error: null });
    this.queue = this.queue.then(() => this.run(id)).finally(() => { this.running.delete(id); });
  }
  async idle() { await this.queue; }
  async reloadPublic(key: string, revision: number): Promise<Draft> {
    if (this.deployingCode) throw new CmsError(423, 'Mory 배포 작업 중입니다. 잠시 후 다시 시도하세요.');
    this.otherGitTasks++;
    const task = this.queue.then(async () => {
      const row = this.store.get(key);
      if (row.revision !== revision) throw new CmsError(409, '서버 작업본이 변경되었습니다. 먼저 최신본을 불러오세요.');
      await this.sync();
      const content = readContent(this.repo);
      let value: Payload | undefined, path = row.path;
      if (row.kind === 'post') {
        const post = content.posts.find(p => p.data.id === row.id);
        if (post) { value = { data: post.data, body: post.body }; path = post.file; }
      } else if (row.kind === 'page') {
        const page = content.pages.find(p => p.key === row.id);
        if (page) value = { data: page.data, body: page.body };
      } else if (row.kind === 'categories') value = { data: content.categories, body: '' };
      else if (content.series[row.id]) value = { data: { id: row.id, ...content.series[row.id] }, body: '' };
      if (!value) throw new CmsError(409, '현재 공개본에서 문서를 찾지 못했습니다. 작업본은 보존됩니다.');
      const now = workspaceTime();
      const updated = await lifecycle(this.store.runtime, () => this.store.db.prepare('UPDATE drafts SET value=?,published=?,base_hash=?,path=?,revision=revision+1,saved_at=?,updated_at=? WHERE key=? AND revision=?').run(JSON.stringify(value), JSON.stringify(value), fileHash(this.repo, path), path, now, now, key, revision));
      if (!updated.changes) throw new CmsError(409, '다른 창에서 저장한 내용이 있습니다.');
      return this.store.get(key);
    });
    this.queue = task.then(() => {}, () => {});
    return task.finally(() => { this.otherGitTasks--; });
  }
  async compatible(sha: string, cwd: string) {
    const schema = await this.git(['show', `${sha}:src/lib/schema.ts`], cwd);
    if (!schema.includes('seriesEntrySchema')) throw new CmsError(400, 'CMS 최초 설치 변경이 아직 반영되지 않았습니다. 초기 배포 후 다시 게시하세요. 자동저장된 내용은 유지됩니다.');
    const marker = await this.git(['ls-tree', '--name-only', sha, '--', 'src/lib/content-contract.ts'], cwd);
    const source = marker ? await this.git(['show', `${sha}:src/lib/content-contract.ts`], cwd) : '';
    const version = marker ? Number(/^export const CONTENT_CONTRACT_VERSION = (\d+);$/m.exec(source)?.[1]) : 1;
    if (version < CONTENT_CONTRACT_VERSION) throw new CmsError(400, '새 문법을 지원하는 사이트 업데이트가 먼저 필요합니다. 작업본은 유지됩니다.');
    if (version !== CONTENT_CONTRACT_VERSION) throw new CmsError(400, '실행 중인 CMS가 최신 콘텐츠 구조를 지원하지 않습니다. CMS를 업데이트하고 직접 재시작한 뒤 다시 게시해 주세요.');
    const ignore = await this.git(['show', `${sha}:.gitignore`], cwd);
    if (!/^\/runtime\/\r?$/m.test(ignore)) throw new CmsError(400, '최신 코드에서도 runtime 전체가 Git에서 제외되어야 합니다. 원격 .gitignore 설정을 확인해 주세요.');
  }
  async retryLocalSync(): Promise<LocalSync | null> {
    if (this.deployingCode) throw new CmsError(423, 'Mory 배포 작업 중입니다. 잠시 후 다시 시도하세요.');
    this.otherGitTasks++;
    const task = this.queue.then(() => this.dev.recover());
    this.queue = task.then(() => {}, () => {});
    return task.finally(() => { this.otherGitTasks--; });
  }
  async sync() {
    if (!existsSync(join(this.repo, '.git'))) {
      mkdirSync(dirname(this.repo), { recursive: true });
      await this.git(['clone', '--', this.options.remote, this.repo], this.store.runtime);
    }
    const urls = (await this.git(['remote', 'get-url', '--all', 'origin'])).split('\n');
    const pushUrls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'])).split('\n');
    if ([...urls, ...pushUrls].some(remote => remoteIdentity(remote, this.repo) !== remoteIdentity(this.options.remote, this.store.root))) throw new CmsError(400, 'CMS 게시 저장소의 원격 주소가 설정과 다릅니다. 서버 설정을 확인해 주세요.');
    await this.git(['fetch', 'origin']);
    const branch = this.options.branch ?? (await this.git(['symbolic-ref', 'refs/remotes/origin/HEAD'])).replace('refs/remotes/origin/', '');
    await this.git(['check-ref-format', '--branch', branch]);
    await this.git(['checkout', '-B', branch, `origin/${branch}`]);
    await this.git(['reset', '--hard', `origin/${branch}`]);
    await this.git(['clean', '-fd']);
    return branch;
  }
  write(row: Draft, payload: Payload) {
    if (!managedContent(row.path)) throw new CmsError(400, 'CMS가 관리하지 않는 파일에는 게시할 수 없습니다.');
    const path = join(this.repo, row.path);
    if (payload.deleted) { rmSync(path, { force: true }); return; }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, row.kind === 'post' || row.kind === 'page' ? `---\n${stringify(payload.data)}---\n${payload.body}` : stringify(payload.data));
  }
  targetBases(row: Draft, job: PublishJob) {
    if (fileHash(this.repo, row.path) !== row.base_hash) throw new CmsError(409, '이 문서의 공개본이 CMS 외부에서 변경되었습니다. 공개본을 다시 불러온 뒤 작업하세요.');
    if (row.kind === 'post' && job.action === 'delete') {
      for (const [id, series] of Object.entries(readContent(this.repo).series)) if (series.posts.includes(row.id)) {
        const draft = this.store.list().find(d => d.kind === 'series' && d.id === id);
        if (draft && draft.base_hash !== fileHash(this.repo, `data/series/${id}.yaml`)) throw new CmsError(409, '관련 시리즈의 공개본이 외부에서 변경되었습니다. 공개본을 다시 불러오세요.');
      }
    }
  }
  async run(id: string) {
    const job = this.store.job(id);
    let acceptedSha: string | undefined;
    try {
      const row = this.store.get(job.key);
      // Never-published archived drafts need no public file, validation or network.
      if (!row.published && ((row.kind === 'post' && ['archive', 'restore', 'delete'].includes(job.action)) || (row.kind === 'series' && job.action === 'delete'))) {
        await lifecycle(this.store.runtime, () => this.completeLocal(row, job)); return;
      }
      // Recovery of an acknowledged-late push must not become a failed
      // publication just because the development checkout is now blocked.
      if (job.commit_sha) {
        const branch = await this.sync();
        const previous = await this.git(['log', '--format=%H', '--fixed-strings', `--grep=Mory-Publish: ${id}`, `origin/${branch}`]);
        if (previous) { acceptedSha = previous.split('\n')[0]; await this.finishPush(row, job, acceptedSha); return; }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const pending = await this.dev.recover();
        if (pending?.pending) throw new CmsError(400, '이전 게시 후 로컬 저장소 동기화가 아직 필요합니다. 로컬 작업을 확인하고 다시 동기화한 뒤 게시해 주세요.');
        const preflight = await this.dev.advance();
        const branch = await this.sync();
        if (branch !== preflight.branch) throw new CmsError(400, '개발 저장소와 CMS의 게시 위치가 다릅니다. 서버 설정을 확인해 주세요.');
        const base = await this.git(['rev-parse', `origin/${branch}`]);
        await this.compatible(base, this.repo);
        this.targetBases(row, job);
        if (job.action === 'publish' && ['post','page'].includes(row.kind)) {
          const names = await this.assets.prepare(row, job.snapshot, this.repo);
          job.snapshot.data.imageDimensions = Object.fromEntries(names.map(name => { const asset = this.assets.find({type:row.kind as 'post'|'page',id:row.id},name)!; return [name,{width:asset.width,height:asset.height}]; }));
          this.store.db.prepare('UPDATE publish_jobs SET snapshot=? WHERE id=?').run(JSON.stringify(job.snapshot),job.id);
        }
        const touched = [row.path];
        const seriesChanges: { id: string; path: string; payload: Payload }[] = [];
        if (row.kind === 'categories') this.store.assertCategoriesDeletedSafely(row.published?.data ?? {}, job.snapshot.data);
        if (row.kind === 'post' && job.action === 'delete') {
          const content = readContent(this.repo);
          for (const [seriesId, data] of Object.entries(content.series)) if (data.posts.includes(row.id)) {
            const path = `data/series/${seriesId}.yaml`;
            const payload = { data: { id: seriesId, ...data, posts: data.posts.filter(p => p !== row.id) }, body: '' };
            writeFileSync(join(this.repo, path), stringify(payload.data)); touched.push(path); seriesChanges.push({ id: seriesId, path, payload });
          }
        }
        this.write(row, job.snapshot);
        const content = readContent(this.repo);
        await validateMarkdown(content, this.repo);
        // One scoped commit only. No developer working-tree files are staged.
        await this.git(['add', '--', ...touched]);
        let sha: string;
        if (!(await this.git(['diff', '--cached', '--name-only']))) sha = await this.git(['rev-parse', 'HEAD']);
        else {
          await this.git(['-c', `user.name=${this.options.author ?? 'Mory CMS'}`, '-c', `user.email=${this.options.email ?? 'mory-cms@users.noreply.github.com'}`, 'commit', '-m', `content: publish ${row.kind}\n\nMory-Publish: ${id}`]);
          sha = await this.git(['rev-parse', 'HEAD']);
        }
        // Persist commit identity before push; a dropped response cannot duplicate a commit.
        this.store.updateJob(id, { commit_sha: sha });
        try {
          await this.git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
        } catch (error) {
          // Determine whether the remote advanced or actually accepted this
          // exact job. Permission/network/hook failures without an advance
          // are not treated as a non-fast-forward race.
          await this.sync();
          const accepted = await this.git(['log', '--format=%H', '--fixed-strings', `--grep=Mory-Publish: ${id}`, `origin/${branch}`]);
          if (accepted) { acceptedSha = accepted.split('\n')[0]; await this.finishPush(row, job, acceptedSha); return; }
          const updated = await this.git(['rev-parse', `origin/${branch}`]);
          if (updated === base) throw error;
          await this.compatible(updated, this.repo);
          this.targetBases(row, job);
          if (attempt === 2) throw new CmsError(400, '원격 저장소가 동시에 변경되고 있어 게시하지 못했습니다. 다시 시도해 주세요.');
          continue;
        }
        acceptedSha = sha; await this.finishPush(row, job, sha, seriesChanges); return;
      }
    } catch (error) {
      if (acceptedSha) {
        // Remote success is irreversible here. Preserve a recoverable job if
        // bookkeeping itself was interrupted, instead of marking publish failed.
        // recordPush commits atomically. If it already completed, do not replay
        // it and increment the draft revision again after a sync-state error.
        if (this.store.job(id).state === 'publishing') this.store.updateJob(id, { state: 'publishing', pushed_at: publicationTime(), commit_sha: acceptedSha, error: '콘텐츠는 게시되었습니다. 게시 상태 기록을 다시 확인해야 합니다.' });
        this.store.setLocalSync({ pending: true, remote_sha: acceptedSha, publication_sha: acceptedSha, error: '게시 후 로컬 상태 확인이 중단되었습니다. 다시 동기화하거나 CMS를 재시작해 주세요.', last_attempt_at: publicationTime() });
        return;
      }
      if (existsSync(join(this.repo, '.git'))) {
        try { await this.git(['reset', '--hard', 'HEAD']); await this.git(['clean', '-fd']); } catch { /* The next publish still reinitializes only the owned clone. */ }
      }
      const conflict = error instanceof CmsError && error.status === 409;
      // Full errors stay on the server. Credentials/Git diagnostics never enter the UI.
      console.error('CMS publish failed:', error instanceof CmsError ? error.message : error instanceof Error ? error.message.replace(/https?:\/\/[^\s]+/g, '[remote]') : 'unknown');
      this.store.updateJob(id, { state: conflict ? 'conflict' : 'failed', error: error instanceof CmsError ? error.message : /콘텐츠 검증|Markdown 검증/.test(String(error)) ? (error instanceof Error ? error.message : String(error)).replaceAll(this.repo + '/', '') : '게시하지 못했습니다. 작업본은 보존되어 있습니다. 연결과 서버 설정을 확인하고 다시 시도하세요.' });
    }
  }
  async finishPush(row: Draft, job: PublishJob, sha: string, seriesChanges: { id: string; path: string; payload: Payload }[] = []) {
    // A recovered acknowledgement can be found below newer remote commits.
    // Record hashes from this publication, never from a later external edit.
    if (await this.git(['rev-parse', 'HEAD']) !== sha) await this.git(['reset', '--hard', sha]);
    await lifecycle(this.store.runtime, () => this.recordPush(row, job, sha, seriesChanges));
    try { await this.assets.published(row, job, this.repo); if(job.action === 'delete') this.assets.deleteStaged(row); } catch { console.warn('CMS image publication bookkeeping deferred'); }
    // recover records failures separately and never throws into publish failure.
    await this.dev.recover();
  }
  completeLocal(row: Draft, job: PublishJob) {
    this.store.db.transaction(() => {
      if (job.action === 'delete') {
        this.store.db.prepare('DELETE FROM drafts WHERE key=?').run(row.key);
        if (row.kind === 'post') this.store.removePostReferences(row.id);
      } else this.store.db.prepare('UPDATE drafts SET value=?,revision=revision+1,saved_at=?,updated_at=? WHERE key=?').run(JSON.stringify(job.snapshot), workspaceTime(), workspaceTime(), row.key);
      this.store.updateJob(job.id, { state: 'complete' });
    })();
    if(job.action === 'delete') this.assets.deleteStaged(row);
  }
  recordPush(row: Draft, job: PublishJob, sha: string, seriesChanges: { id: string; path: string; payload: Payload }[] = []) {
    if (row.kind === 'post' && job.action === 'delete' && !seriesChanges.length) {
      const content = readContent(this.repo);
      seriesChanges = this.store.list().filter(d => d.kind === 'series' && d.published?.data.posts?.includes(row.id)).flatMap(d => content.series[d.id] ? [{ id: d.id, path: d.path, payload: { data: { id: d.id, ...content.series[d.id] }, body: '' } }] : []);
    }
    this.store.db.transaction(() => {
      if (job.action === 'delete') {
        this.store.db.prepare('DELETE FROM drafts WHERE key=?').run(row.key);
        if (row.kind === 'post') this.store.removePostReferences(row.id);
      } else {
        const latest = this.store.get(row.key);
        const value = row.kind === 'post' && ['archive','restore'].includes(job.action) ? { ...latest.value, data: { ...latest.value.data, status: job.snapshot.data.status } } : latest.revision === job.revision ? job.snapshot : latest.value;
        this.store.db.prepare('UPDATE drafts SET value=?,published=?,base_hash=?,ever_published=?,revision=revision+1,saved_at=?,updated_at=? WHERE key=?')
          .run(JSON.stringify(value), JSON.stringify(job.snapshot), fileHash(this.repo, row.path), +(row.ever_published || (row.kind === 'post' ? job.snapshot.data.status === 'published' : true)), workspaceTime(), workspaceTime(), row.key);
      }
      for (const change of seriesChanges) this.store.db.prepare('UPDATE drafts SET published=?,base_hash=? WHERE key=?').run(JSON.stringify(change.payload), fileHash(this.repo, change.path), `series:${change.id}`);
      this.store.updateJob(job.id, { state: 'deploying', pushed_at: publicationTime(), commit_sha: sha, error: null });
      this.store.setLocalSync({ pending: true, remote_sha: sha, publication_sha: sha, error: null, last_attempt_at: publicationTime() });
    })();
  }
  async deployment(id: string): Promise<PublishJob> {
    let job = this.store.job(id);
    if (!(job.state === 'deploying' || (job.state === 'failed' && job.pushed_at)) || !job.commit_sha) return job;
    if (this.checking.has(id) || Date.now() - (this.lastChecked.get(id) ?? 0) < (this.options.deploymentIntervalMs ?? 0)) return job;
    this.checking.add(id); this.lastChecked.set(id, Date.now());
    try {
      const result = await this.options.deployment?.(job.commit_sha);
      if (result) this.store.updateJob(id, { state: result.state, run_url: result.url ?? job.run_url, error: result.error ?? null });
    } catch { if (job.state === 'deploying') this.store.updateJob(id, { error: '배포 상태를 확인하지 못했습니다. 완료 여부를 계속 확인합니다.' }); }
    this.checking.delete(id);
    return this.store.job(id);
  }
  async retryDeployment(id: string): Promise<PublishJob> {
    const existing = this.retrying.get(id);
    if (existing) return existing;
    const task = this.retryCheckedDeployment(id);
    this.retrying.set(id, task);
    void task.then(() => this.retrying.delete(id), () => this.retrying.delete(id));
    return task;
  }
  private async retryCheckedDeployment(id: string): Promise<PublishJob> {
    if (this.checking.has(id)) throw new CmsError(423, '배포 상태를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.');
    this.lastChecked.delete(id);
    const job = await this.deployment(id);
    if (job.state === 'complete' || job.state === 'superseded') return job;
    if (job.state === 'deploying') return job;
    if (job.state !== 'failed' || !job.pushed_at || !job.run_url) throw new CmsError(400, '다시 실행할 배포를 찾지 못했습니다.');
    if (!this.options.retryDeployment) throw new CmsError(400, '배포 재시도에는 서버의 GitHub 권한 설정이 필요합니다.');
    this.store.updateJob(id, { state: 'deploying', error: null });
    try { await this.options.retryDeployment(job.run_url); this.lastChecked.set(id, Date.now()); }
    catch { this.store.updateJob(id, { state: 'failed', error: '배포를 다시 시작하지 못했습니다. 서버 연결과 GitHub 권한 설정을 확인하세요.' }); }
    return this.store.job(id);
  }
  resume() { this.queue = this.queue.then(async () => { await this.assets.recoverPublications(); await this.dev.recover(); }); for (const job of this.store.jobs().filter(j => j.state === 'publishing')) this.enqueue(job.id); }
}
export function githubRetry(token: string | undefined, transport: typeof fetch = fetch) {
  if (!token) return undefined;
  return async (url: string) => {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(url);
    if (!match) throw new Error('Invalid workflow run URL');
    const response = await transport(`https://api.github.com/repos/${match[1]}/actions/runs/${match[2]}/rerun`, { method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'Mory-CMS' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Deployment retry failed');
  };
}
export function githubDeployment(remote: string, token?: string, workflow = 'deploy.yml', branch = 'main') {
  const repository = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1];
  return async (sha: string): Promise<{ state: 'deploying' | 'complete' | 'superseded' | 'failed'; url?: string; error?: string }> => {
    if (!repository) return { state: 'deploying', error: '배포 상태 확인을 지원하지 않는 저장소입니다. 게시 완료 여부를 별도로 확인하세요.' };
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?head_sha=${sha}&event=push&per_page=10`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mory-CMS', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Deployment API unavailable');
    const data = await response.json() as { workflow_runs: { head_sha: string; status: string; conclusion: string | null; html_url: string; run_attempt: number }[] };
    const run = data.workflow_runs.filter(r => r.head_sha === sha).sort((a, b) => b.run_attempt - a.run_attempt)[0];
    if (!run || (run.status === 'completed' && run.conclusion !== 'success')) {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Mory-CMS', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
      const latestResponse = await fetch('https://api.github.com/repos/' + repository + '/actions/workflows/' + encodeURIComponent(workflow) + '/runs?branch=' + encodeURIComponent(branch) + '&status=success&per_page=1', { headers, signal: AbortSignal.timeout(15_000) });
      if (!latestResponse.ok) throw new Error('Deployment API unavailable');
      const latestData = await latestResponse.json() as typeof data;
      const latest = latestData.workflow_runs.find(r => r.status === 'completed' && r.conclusion === 'success');
      if (latest) {
        if (latest.head_sha === sha) return { state: 'complete', url: latest.html_url };
        const compared = await fetch('https://api.github.com/repos/' + repository + '/compare/' + encodeURIComponent(sha) + '...' + encodeURIComponent(latest.head_sha), { headers, signal: AbortSignal.timeout(15_000) });
        if (!compared.ok) throw new Error('Commit ancestry unavailable');
        const ancestry = await compared.json() as { status: string; merge_base_commit: { sha: string } };
        if (ancestry.status === 'ahead' && ancestry.merge_base_commit?.sha === sha) return { state: 'superseded', url: latest.html_url };
      }
    }
    if (!run) return { state: 'deploying' };
    return { state: run.status !== 'completed' ? 'deploying' : run.conclusion === 'success' ? 'complete' : 'failed', url: run.html_url, error: run.status === 'completed' && run.conclusion !== 'success' ? '작업본은 보존되어 있습니다. GitHub에서 실패 원인을 확인하세요.' : undefined };
  };
}
