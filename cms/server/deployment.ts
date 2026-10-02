import { createHash } from 'node:crypto';
import type { DeployState, WorkflowRun } from '../deployment.ts';
import { CmsError } from '../shared.ts';
import { Publisher, githubRetry } from './publish.ts';

export interface DeploymentAPI {
  lookup(sha: string): Promise<WorkflowRun | null>;
  rerun?(run: WorkflowRun): Promise<void>;
}
export function githubActions(remote: string, token?: string, workflow = 'deploy.yml', branch = 'main', transport: typeof fetch = fetch): DeploymentAPI {
  const repository = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
  const retry = githubRetry(token, transport);
  return {
    async lookup(sha) {
      if (!repository) throw new CmsError(400, 'GitHub 배포 조회를 지원하지 않는 원격 주소입니다.');
      const response = await transport(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?head_sha=${encodeURIComponent(sha)}&branch=${encodeURIComponent(branch)}&per_page=100`, {
        headers: { Accept:'application/vnd.github+json', 'User-Agent':'Mory-CMS', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, signal:AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new CmsError(400, 'GitHub 상태 확인 실패 · 연결과 서버의 Actions 조회 권한을 확인하세요.');
      const data = await response.json() as { workflow_runs: { id:number; head_sha:string; head_branch:string; event:string; name:string; status:string; conclusion:string|null; html_url:string; updated_at:string; run_attempt:number }[] };
      // Only this source SHA and branch; never inherit an older/newer successful deployment.
      const run = data.workflow_runs.filter(r => r.head_sha === sha && r.head_branch === branch && ['push','workflow_dispatch'].includes(r.event)).sort((a,b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
      if (!run) return null;
      return { id:run.id, sha:run.head_sha, name:run.name, status:run.status, conclusion:run.conclusion,
        url:run.html_url === `https://github.com/${repository}/actions/runs/${run.id}` ? run.html_url : '', at:run.updated_at, attempt:run.run_attempt };
    },
    ...(retry ? { rerun: (run: WorkflowRun) => retry(run.url) } : {}),
  };
}

export function suggestCommitMessage(files: string[]) {
  const areas = new Set(files.map(path => {
    if (/(backup|recovery|autosave|lifecycle-lock|hardening)/i.test(path)) return 'backup';
    if (/(asset|image|r2|caption)/i.test(path)) return 'image';
    if (/\.(md|txt)$/.test(path) && !path.startsWith('src/content/')) return 'docs';
    if (/\.(css|scss)$/.test(path)) return 'style';
    if (path.startsWith('cms/')) return 'cms';
    if (path.startsWith('src/') || path.startsWith('astro.')) return 'site';
    return 'other';
  }));
  if (areas.size !== 1) return 'chore: Mory 업데이트';
  return ({ backup:'fix: 백업 및 복구 안정성 개선', image:'feat: 이미지 처리 개선', docs:'docs: Mory 문서 업데이트', style:'style: CMS UI 조정', cms:'feat: CMS 기능 개선', site:'feat: 사이트 렌더링 개선', other:'chore: Mory 업데이트' })[[...areas][0] as 'other'];
}

/** Git/Actions are the source of truth. No separate persisted "deployed" flag. */
export class MoryDeployment {
  private phase: DeployState['phase'] = 'idle';
  private cached?: DeployState;
  private checking?: Promise<DeployState>;
  private lastFetch = 0;
  private lastError?: string;
  private rerunning?: { id:number; attempt:number; until:number };
  constructor(public publisher: Publisher, public api: DeploymentAPI, public pollDelayMs = 1500) {}
  private get dev() { return this.publisher.dev; }
  private async details(fetchRemote: boolean): Promise<DeployState> {
    const branch = this.publisher.options.branch ?? 'main';
    await this.dev.inspect(branch);
    if ((await this.dev.git(['ls-files','--','.env'])).trim()) throw new CmsError(400,'환경설정 파일이 Git에 포함되어 있습니다. credential 추적 상태를 먼저 확인하세요.');
    try { await this.dev.git(['check-ignore','--quiet','--no-index','--','.env']); } catch { throw new CmsError(400,'.env가 Git에서 제외되어야 배포할 수 있습니다. ignore 설정을 확인하세요.'); }
    if (fetchRemote || Date.now() - this.lastFetch > 60_000) {
      await this.dev.git(['fetch','--no-recurse-submodules','origin',branch]); this.lastFetch = Date.now();
    }
    const local = (await this.dev.git(['rev-parse','HEAD'])).trim(), remote = (await this.dev.git(['rev-parse',`origin/${branch}`])).trim();
    const [ahead, behind] = (await this.dev.git(['rev-list','--left-right','--count',`HEAD...origin/${branch}`])).trim().split(/\s+/).map(Number);
    const snapshot = await this.dev.snapshot(true);
    const origin = (await this.dev.git(['remote','get-url','origin'])).trim();
    // Credentials embedded in remote URLs must never reach the browser.
    const safeOrigin = origin.includes('://') ? (() => { const u=new URL(origin); u.username='';u.password='';u.search='';u.hash='';return u.toString(); })() : origin;
    const count = (raw:string) => raw.split('\0').filter(Boolean).length;
    const state: DeployState = { branch, local, remote, origin:safeOrigin, ahead, behind, changed:snapshot.dirty.length,
      staged:count(await this.dev.git(['diff','--cached','--name-only','--no-renames','-z'])), unstaged:count(await this.dev.git(['diff','--name-only','--no-renames','-z'])), untracked:snapshot.untracked.length,
      fingerprint:createHash('sha256').update(JSON.stringify({ local, remote, snapshot })).digest('hex'),
      suggestedMessage:suggestCommitMessage(snapshot.dirty), action:'none', phase:this.phase, busy:false, run:null, canRerun:!!this.api.rerun, checkedAt:new Date().toISOString(), lastError:this.lastError };
    if (ahead && behind) state.blocked = '로컬과 원격 기록이 갈라져 있어 자동 배포할 수 없습니다. 작업을 직접 확인하세요.';
    const pending=this.publisher.store.localSync();
    if(pending?.pending) {
      try { await this.dev.git(['merge-base','--is-ancestor',pending.publication_sha,remote]); }
      catch { state.blocked='콘텐츠 게시 후 원격 상태를 확인하지 못했습니다. 로컬 동기화 문제를 먼저 확인하세요.'; }
    }
    try {
      state.run = await this.api.lookup(remote);
      if (this.rerunning && state.run?.id === this.rerunning.id && state.run.attempt <= this.rerunning.attempt && state.run.status === 'completed' && Date.now() < this.rerunning.until) state.run = { ...state.run, status:'queued', conclusion:null };
    } catch { state.githubError = 'GitHub 상태 확인 실패 · 서버 연결과 Actions 권한을 확인하세요.'; }
    if (!state.blocked) state.action = behind ? 'sync' : state.changed ? 'commit' : ahead ? 'push' : state.run?.status === 'completed' && ['failure','cancelled'].includes(state.run.conclusion ?? '') && this.api.rerun ? 'rerun' : 'none';
    return state;
  }
  async status(force = false): Promise<DeployState> {
    if (this.phase !== 'idle' || this.publisher.gitBusy) return { ...this.cached ?? this.empty(), phase:this.phase, busy:true, action:'none' };
    if (this.checking) return this.checking;
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 3000) return this.cached;
    this.checking = (async () => {
      try { this.cached = await this.details(force); }
      catch (error) { this.cached = { ...this.empty(), blocked:error instanceof CmsError ? error.message : 'Git 저장소를 확인하지 못했습니다. 저장소와 SSH 연결 상태를 확인하세요.' }; }
      return this.cached;
    })();
    try { return await this.checking; } finally { this.checking=undefined; }
  }
  private empty(): DeployState { return { ahead:0,behind:0,changed:0,staged:0,unstaged:0,untracked:0,suggestedMessage:'chore: Mory 업데이트',action:'none',phase:this.phase,busy:false,run:null,canRerun:!!this.api.rerun,checkedAt:new Date().toISOString(),lastError:this.lastError }; }
  async execute(input: { action:DeployState['action']; fingerprint?:string; message?:string }): Promise<DeployState> {
    return this.publisher.deployExclusive(async () => {
      this.lastError=undefined;
      let pushedSha: string | undefined;
      try {
        // An earlier read must finish before our exclusive Git mutation begins.
        if (this.checking) await this.checking;
        this.phase='syncing';
        let state = await this.details(true);
        if (state.blocked) throw new CmsError(409,state.blocked);
        if (input.action !== state.action || input.fingerprint !== state.fingerprint) throw new CmsError(409,'검사 이후 Mory 작업 상태가 변경되었습니다. 최신 상태를 확인하고 다시 실행하세요.');
        if (state.action === 'sync') {
          // Shared dev-sync preserves staged/unstaged/untracked files. Content changes are intended here.
          await this.dev.advance(undefined,true);
          if (this.publisher.store.localSync()?.pending) await this.dev.recover();
        } else if (state.action === 'commit' || state.action === 'push') {
          let expectedHead=state.local!;
          if (state.action === 'commit') {
            const message=input.message?.trim();
            if (!message || message.length>1000 || message.includes('\0')) throw new CmsError(400,'커밋 메시지를 입력해 주세요.');
            this.phase='committing';
            await this.dev.inspect(state.branch);
            // Recheck the exact confirmed files/content, including partial staging.
            const check = await this.details(true);
            if (check.fingerprint !== state.fingerprint) throw new CmsError(409,'확인 이후 변경사항이 달라졌습니다. 다시 확인하세요.');
            await this.dev.git(['add','-A']);
            await this.dev.git(['commit','-m',message]);
            expectedHead=(await this.dev.git(['rev-parse','HEAD'])).trim();
          }
          this.phase='pushing';
          await this.dev.inspect(state.branch);
          state=await this.details(true); // Remote race: only a normal fast-forward push is permitted.
          if (state.behind || state.blocked) throw new CmsError(409,'커밋은 보존되어 있습니다. 원격이 변경되어 안전하게 push할 수 없습니다. 상태를 확인하세요.');
          const sha=(await this.dev.git(['rev-parse','HEAD'])).trim();
          if(sha!==expectedHead || state.local!==expectedHead) throw new CmsError(409,'배포 중 다른 작업이 로컬 커밋을 변경했습니다. 새 상태를 확인한 뒤 다시 배포하세요.');
          await this.dev.git(['push','origin',`${sha}:refs/heads/${state.branch}`]);
          pushedSha=sha;
          await this.dev.git(['fetch','origin',state.branch!]); this.lastFetch=Date.now();
          // Allow Actions a short creation delay. No empty commit / re-push fallback.
          for (let n=0;n<4;n++) {
            try { if (await this.api.lookup(sha)) break; } catch { break; }
            if(n<3) await new Promise(r=>setTimeout(r,this.pollDelayMs));
          }
        } else if (state.action === 'rerun') {
          this.phase='rerunning';
          await this.api.rerun!(state.run!);
          this.rerunning={id:state.run!.id,attempt:state.run!.attempt,until:Date.now()+30_000};
        }
      } catch (error) {
        this.lastError = pushedSha ? 'Push는 완료되었습니다. 원격/배포 상태 확인에 실패했습니다. 상태를 새로고침하세요.' : error instanceof CmsError ? error.message : this.phase === 'rerunning' ? '다시 배포하지 못했습니다. 서버의 GitHub Actions 쓰기 권한과 연결을 확인하세요.' : this.phase === 'pushing' ? 'Push에 실패했습니다. 로컬 커밋은 보존되어 있습니다. SSH 연결과 원격 상태를 확인하세요.' : this.phase === 'committing' ? '커밋하지 못했습니다. 로컬 변경은 보존되어 있습니다. Git 사용자 설정과 작업 상태를 확인하세요.' : '안전하게 동기화하지 못했습니다. 로컬 작업은 보존되어 있습니다.';
        throw new CmsError(error instanceof CmsError ? error.status : 400,this.lastError);
      } finally { this.phase='idle'; this.cached=undefined; }
      // Still own the queue here: reconstruct directly, not through the busy status shortcut.
      try { return this.cached=await this.details(true); }
      catch { return this.cached={...this.empty(),blocked:'Git 상태를 다시 확인해 주세요.'}; }
    });
  }
}
