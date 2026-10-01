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
  state: 'publishing' | 'deploying' | 'complete' | 'superseded' | 'failed' | 'conflict';
  pushed_at: string | null; commit_sha: string | null; error: string | null; run_url: string | null;
  started_at: string; updated_at: string;
}
export class CmsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Both workspace and public references must be moved before deleting a category. */
export function categoryReferences(drafts: Draft[], id: string) {
  return drafts.filter(d => d.kind === 'post' && (d.value.data.category === id || d.published?.data.category === id)).map(d => ({
    key: d.key,
    title: d.value.data.title || d.published?.data.title || '제목 없는 글',
    status: d.status,
    source: d.value.data.category === id ? (d.published?.data.category === id ? '작업본·공개본' : '작업본') : '공개본',
  }));
}

export interface LinkIssueDocument {
  key: string; title: string; kind: 'post' | 'page'; status: Draft['status'];
  sources: { source: '작업본' | '공개본'; links: { target: string; label: string; line: number }[] }[];
}
