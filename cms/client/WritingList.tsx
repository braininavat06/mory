import React from 'react';
import type { Draft } from '../shared.ts';
import { displayDate } from '../../src/lib/dates.ts';

export function WritingList({ posts, drafts, categories, select, status }: {
  posts: Draft[];
  drafts: Draft[];
  categories: Record<string, { name: string }>;
  select: (draft: Draft) => void;
  status: (draft: Draft) => string;
}) {
  const memberships = new Map<string, string[]>();
  for (const draft of drafts) {
    if (draft.kind !== 'series' || draft.value.deleted) continue;
    for (const id of new Set<string>(draft.value.data.posts ?? [])) {
      const names = memberships.get(id) ?? [];
      names.push(draft.value.data.name || '이름 없는 시리즈');
      memberships.set(id, names);
    }
  }
  if (!posts.length) return <p className="empty-state">조건에 맞는 글이 없습니다.</p>;
  return <ul className="writing-items cms-writing-items">{posts.map(draft => {
    const data = draft.value.data;
    const series = memberships.get(draft.id) ?? [];
    return <li key={draft.key}>
      <div className="post-meta">{categories[data.category]?.name ?? '분류 없음'}</div>
      <h2><button className="cms-writing-open" onClick={() => select(draft)}>{data.title || '제목 없는 글'}</button></h2>
      {data.description && <p>{data.description}</p>}
      {series.length > 0 && <div className="post-series"><span>시리즈:</span> {series.join(' · ')}</div>}
      <div className="post-dates">
        {data.publishedAt && <time dateTime={data.publishedAt}>{displayDate(data.publishedAt)}</time>}
        <span>{status(draft)}</span>
        <span>CMS 수정 <time dateTime={draft.updated_at}>{displayDate(draft.updated_at)}</time></span>
      </div>
    </li>;
  })}</ul>;
}
