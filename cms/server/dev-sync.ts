import { existsSync, realpathSync, lstatSync, readlinkSync, createReadStream } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gitOutput } from './git.ts';
import { managedContent } from './content-paths.ts';
import { CmsError } from '../shared.ts';
import type { Store } from './store.ts';
import type { LocalSync } from '../shared.ts';
import { publicationTime } from '../../src/lib/dates.ts';

export function remoteIdentity(remote: string, cwd: string) {
  if (remote.startsWith('file://')) return `file:${realpathSync(fileURLToPath(remote))}`;
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(remote);
  if (!remote.includes('://') && (!scp || isAbsolute(remote))) return `file:${realpathSync(resolve(cwd, remote))}`;
  const url = new URL(remote.includes('://') ? remote : `ssh://${scp![1]}/${scp![2]}`);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return `${host}${url.port && !['22','443','80'].includes(url.port) ? ':' + url.port : ''}/${host === 'github.com' ? path.toLowerCase() : path}`;
}
const paths = (raw: string) => raw.split('\0').filter(Boolean).sort();
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

export class DevSync {
  private lastRemote?: string;
  constructor(public store: Store, public remote: string, public configuredBranch?: string,
    public compatible: (sha: string, cwd: string) => Promise<void> = async () => {}) {}
  async git(args: string[]) { return gitOutput(args, this.store.root); }
  async branch() {
    if (this.configuredBranch) return this.configuredBranch;
    const refs = await this.git(['ls-remote', '--symref', 'origin', 'HEAD']);
    const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(refs)?.[1];
    if (!branch) throw new CmsError(400, '원격 저장소의 기본 게시 위치를 확인하지 못했습니다. 서버 설정을 확인해 주세요.');
    return branch;
  }
  async inspect(branch?: string) {
    const root = (await this.git(['rev-parse', '--show-toplevel'])).trim();
    if (realpathSync(root) !== realpathSync(this.store.root)) throw new CmsError(400, 'Mory 개발 저장소 경로가 올바르지 않습니다.');
    let current: string;
    try { current = (await this.git(['symbolic-ref', '--short', 'HEAD'])).trim(); }
    catch { throw new CmsError(400, '로컬 Mory 저장소가 정상적인 작업 브랜치에 있지 않습니다. 게시 위치로 돌아온 뒤 다시 시도하세요.'); }
    if (branch && current !== branch) throw new CmsError(400, '로컬 Mory 저장소가 게시 브랜치에 있지 않습니다. 작업 상태를 확인한 뒤 다시 시도하세요.');
    for (const direction of [[], ['--push']]) {
      let urls: string[];
      try { urls = (await this.git(['remote', 'get-url', ...direction, '--all', 'origin'])).trim().split('\n').filter(Boolean); }
      catch { throw new CmsError(400, '로컬 Mory 저장소에 원격 연결이 없습니다. 서버 설정을 확인해 주세요.'); }
      if (!urls.length || urls.some(url => remoteIdentity(url, this.store.root) !== remoteIdentity(this.remote, this.store.root))) throw new CmsError(400, '로컬 Mory 저장소와 CMS 게시 저장소의 원격 주소가 다릅니다. 설정을 확인해 주세요.');
    }
    const gitDir = (await this.git(['rev-parse', '--absolute-git-dir'])).trim();
    const common = resolve(this.store.root, (await this.git(['rev-parse', '--git-common-dir'])).trim());
    const markers = ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer','BISECT_LOG','BISECT_START','index.lock','HEAD.lock'];
    if ([gitDir, common].some(dir => markers.some(marker => existsSync(join(dir, marker))))) throw new CmsError(400, '로컬 Mory 저장소에서 다른 Git 작업이 진행 중입니다. 해당 작업을 완료하거나 직접 정리한 뒤 게시하세요.');
    if (await this.git(['ls-files', '-u', '-z'])) throw new CmsError(400, '로컬 Mory 저장소에 해결되지 않은 파일 충돌이 있습니다. 먼저 충돌을 해결해 주세요.');
    if ((await this.git(['ls-files', '-v', '-z'])).split('\0').some(entry => /^[a-zS] /.test(entry))) throw new CmsError(400, '로컬 파일에 특수한 추적 설정이 있어 변경 보존을 확인할 수 없습니다. 파일 추적 설정을 먼저 확인해 주세요.');
    if (await this.git(['ls-files', '-z', '--', 'runtime/'])) throw new CmsError(400, 'runtime 실행 데이터가 Git 관리 대상에 들어 있습니다. 먼저 추적 상태를 확인해 주세요.');
    for (const path of ['runtime/__cms_probe__','runtime/cms.sqlite','runtime/backups/__cms_probe__','runtime/publish-repo/__cms_probe__']) {
      try { await this.git(['check-ignore', '--quiet', '--no-index', '--', path]); }
      catch { throw new CmsError(400, 'runtime 전체가 Git에서 제외되어야 합니다. .gitignore 설정을 확인해 주세요.'); }
    }
  }
  async snapshot() {
    const staged = await this.git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']);
    const unstaged = await this.git(['diff', '--raw', '--no-abbrev', '--no-renames', '-z']);
    const tracked = [...paths(await this.git(['diff', '--cached', '--name-only', '--no-renames', '-z'])), ...paths(await this.git(['diff', '--name-only', '--no-renames', '-z']))];
    const untracked = paths(await this.git(['ls-files', '--others', '--exclude-standard', '-z']));
    const dirty = [...new Set([...tracked, ...untracked])].sort();
    // Managed source files must also be clean when a local ignore rule hides them.
    const sourceFiles = paths(await this.git(['ls-files', '--others', '-z', '--', 'src/content/posts/', 'src/content/pages/', 'src/data/categories.yaml', 'src/data/series.yaml', 'data/series/']));
    const content = [...new Set([...dirty, ...sourceFiles])].filter(managedContent);
    if (content.length) throw new CmsError(400, `공개 콘텐츠 파일에 로컬 수정이 있어 게시할 수 없습니다. CMS 밖에서 수정한 내용을 먼저 정리해 주세요.\n${content.join('\n')}`);
    const files = await Promise.all(dirty.map(async path => {
      const absolute = join(this.store.root, path);
      let stat;
      try { stat = lstatSync(absolute); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, 'missing']; throw error; }
      if (stat.isSymbolicLink()) return [path, `link:${stat.mode}:${readlinkSync(absolute)}`];
      if (!stat.isFile()) throw new CmsError(400, '로컬 하위 저장소 또는 특수 파일 작업이 있어 자동 동기화할 수 없습니다. 작업 상태를 먼저 확인해 주세요.');
      const hash = createHash('sha256'); for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      return [path, `${stat.mode}:${hash.digest('hex')}`];
    }));
    const index = dirty.length ? await this.git(['ls-files', '--stage', '-z', '--', ...dirty]) : '';
    return { staged, unstaged, untracked, dirty, files, index };
  }
  async advance(publication?: string) {
    this.lastRemote = undefined;
    try {
      await this.inspect();
      const branch = await this.branch(); await this.inspect(branch);
      const before = await this.snapshot();
      await this.git(['fetch', '--no-recurse-submodules', 'origin', branch]);
      const ref = `refs/remotes/origin/${branch}`;
      const head = (await this.git(['rev-parse', 'HEAD'])).trim();
      const remote = (await this.git(['rev-parse', ref])).trim();
      this.lastRemote = remote;
      const [ahead] = (await this.git(['rev-list', '--left-right', '--count', `HEAD...${ref}`])).trim().split(/\s+/).map(Number);
      if (ahead) throw new CmsError(400, '로컬 Mory 저장소에 아직 원격에 반영되지 않은 커밋이 있어 게시할 수 없습니다. 해당 작업을 먼저 확인해 주세요.');
      await this.compatible(remote, this.store.root);
      const incoming = paths(await this.git(['diff', '--name-only', '--no-renames', '-z', head, remote]));
      const tracked = new Set(paths(await this.git(['ls-tree', '-r', '--name-only', '-z', head])));
      if (incoming.some(path => path.startsWith('runtime/'))) throw new CmsError(400, '원격 저장소에서 runtime 실행 데이터를 추적하고 있습니다. 원격 콘텐츠를 먼저 확인해 주세요.');
      if (incoming.some(path => !tracked.has(path) && existsSync(join(this.store.root, path)))) throw new CmsError(400, '원격에서 추가된 파일과 로컬 파일이 겹쳐 자동 동기화할 수 없습니다. 로컬 파일을 먼저 확인해 주세요.');
      if (incoming.some(path => before.dirty.some(local => overlaps(path, local)))) throw new CmsError(400, '최신 공개본의 파일과 로컬 작업이 겹쳐 자동 동기화할 수 없습니다. 로컬 작업을 먼저 확인해 주세요.');
      await this.inspect(branch);
      if ((await this.git(['rev-parse','HEAD'])).trim() !== head || JSON.stringify(await this.snapshot()) !== JSON.stringify(before)) throw new CmsError(400, '검사 중 로컬 작업이 변경되었습니다. 작업을 되돌리지 않았습니다. 상태를 확인하고 다시 시도해 주세요.');
      if (head !== remote) {
        // This is the only working-tree mutation allowed in the development repo.
        // Disable configured autostash and post-merge hooks for this invocation.
        await this.git(['-c', `core.hooksPath=${join(this.store.runtime, 'no-hooks')}`, 'merge', '--ff-only', '--no-autostash', remote]);
      }
      await this.inspect(branch);
      if (JSON.stringify(await this.snapshot()) !== JSON.stringify(before)) throw new CmsError(400, '동기화 중 로컬 작업 상태가 변경되었습니다. 작업을 되돌리지 않았습니다. 상태를 확인해 주세요.');
      if ((await this.git(['rev-parse', 'HEAD'])).trim() !== remote) throw new CmsError(400, '동기화 중 로컬 커밋이 변경되었습니다. 현재 작업을 확인해 주세요.');
      if (publication) {
        try { await this.git(['merge-base', '--is-ancestor', publication, 'HEAD']); }
        catch { throw new CmsError(400, '게시한 콘텐츠가 아직 로컬 저장소에 포함되지 않았습니다. 원격 상태를 확인해 주세요.'); }
      }
      return { branch, remote };
    } catch (error) {
      if (error instanceof CmsError) throw error;
      throw new CmsError(400, '로컬 Mory 저장소를 확인하거나 최신화하지 못했습니다. Git 작업과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
    }
  }
  async recover(): Promise<LocalSync | null> {
    const pending = this.store.localSync();
    if (!pending?.pending) return pending;
    let remote = pending.remote_sha;
    try {
      const result = await this.advance(pending.publication_sha); remote = result.remote;
      this.store.setLocalSync({ ...pending, pending: false, remote_sha: remote, error: null, last_attempt_at: publicationTime() });
    } catch (error) {
      remote = this.lastRemote ?? remote;
      this.store.setLocalSync({ ...pending, remote_sha: remote, error: (error as Error).message, last_attempt_at: publicationTime() });
    }
    return this.store.localSync();
  }
}
