export type Kind = 'post' | 'page' | 'categories' | 'series';
export interface Payload { data: Record<string, any>; body: string; deleted?: boolean }
export interface Draft {
  key: string; kind: Kind; id: string; path: string; revision: number;
  value: Payload; published: Payload | null; base_hash: string | null;
  ever_published: boolean; saved_at: string; updated_at: string;
  status: '초안' | '게시됨' | '수정 중' | '보관됨';
}
export type Action = 'publish' | 'archive' | 'restore' | 'delete';
export interface LocalSync { pending: boolean; remote_sha: string; publication_sha: string; error: string | null; last_attempt_at: string }
export interface PublishJob {
  id: string; key: string; revision: number; action: Action; snapshot: Payload;
  state: 'publishing' | 'deploying' | 'complete' | 'failed' | 'conflict';
  pushed_at: string | null; commit_sha: string | null; error: string | null; run_url: string | null;
  started_at: string; updated_at: string;
}
export class CmsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
