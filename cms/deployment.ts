export type DeployAction = 'commit' | 'push' | 'sync' | 'rerun' | 'none';
export type DeployPhase = 'idle' | 'committing' | 'pushing' | 'syncing' | 'rerunning';
export interface WorkflowRun {
  id: number; sha: string; name: string; status: string; conclusion: string | null;
  url: string; at: string; attempt: number;
}
export interface DeployState {
  branch?: string; local?: string; remote?: string; ahead: number; behind: number;
  changed: number; staged: number; unstaged: number; untracked: number;
  origin?: string; fingerprint?: string; suggestedMessage: string;
  action: DeployAction; phase: DeployPhase; busy: boolean; blocked?: string;
  run: WorkflowRun | null; githubError?: string; canRerun: boolean;
  checkedAt: string; lastError?: string;
}
export function deploymentLabel(state?: DeployState) {
  if (!state) return '배포';
  if (state.phase !== 'idle') return { committing:'커밋 중', pushing:'Push 중', syncing:'동기화 중', rerunning:'배포 대기' }[state.phase];
  if (state.busy) return '게시 중';
  if (state.blocked) return '! Git 오류';
  if (state.changed) return `변경 ${state.changed}`;
  if (state.ahead) return 'Push 필요';
  if (state.behind) return '동기화 필요';
  if (state.githubError) return '! 상태 확인 실패';
  if (!state.run) return '배포 실행 기록 없음';
  if (state.run.status !== 'completed') return state.run.status === 'in_progress' ? '◌ 배포 중' : '◌ 배포 대기';
  return state.run.conclusion === 'success' ? '✓ 배포 완료' : state.run.conclusion === 'cancelled' ? '! 배포 취소' : '! 배포 실패';
}
