import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WritingList } from '../client/WritingList.tsx';
import type { Draft } from '../shared.ts';
const defaults = { path: '', revision: 1, published: null, base_hash: null, ever_published: false, saved_at: '2026-10-05T12:30:00+09:00', updated_at: '2026-10-05T12:30:00+09:00', status: '초안' as const };
const post = { ...defaults, key: 'post:a', kind: 'post', id: 'a', updated_at: '2026-10-05T12:30:00+09:00', status: '수정 중', value: { data: { title: '작업본 제목', category: 'tech', description: '짧은 설명', publishedAt: '2026-10-01T10:00:00+09:00' }, body: '목록에 표시하지 않을 본문' } } as Draft;
const series = (id: string, name: string, deleted = false) => ({ ...defaults, key: `series:${id}`, kind: 'series', id, value: { data: { name, posts: ['a', 'a'] }, body: '', deleted } } as Draft);
const render = (posts: Draft[], drafts: Draft[]) => renderToStaticMarkup(React.createElement(WritingList, { posts, drafts, categories: { tech: { name: '기술' } }, select: () => {}, status: d => d.status }));
test('CMS writing list shows description and multiple working series with public layout classes', () => {
 const html = render([post], [post, series('first', '첫 시리즈'), series('second', '다른 시리즈'), series('deleted', '삭제한 시리즈', true)]);
 for (const text of ['작업본 제목', '짧은 설명', '기술', '첫 시리즈 · 다른 시리즈', '수정 중', 'CMS 수정', 'writing-items', 'post-series', 'post-dates']) assert.ok(html.includes(text), text);
 assert.equal((html.match(/첫 시리즈/g) ?? []).length, 1);
 assert.ok(!html.includes('삭제한 시리즈'));
 assert.ok(!html.includes('목록에 표시하지 않을 본문'));
});
test('untitled draft with no description, category or series renders without empty fields', () => {
 const html = render([{ ...post, value: { data: {}, body: '' } }], []);
 assert.ok(html.includes('제목 없는 글'));
 assert.ok(html.includes('분류 없음'));
 assert.ok(!html.includes('post-series'));
 assert.ok(!html.includes('<p></p>'));
});
test('empty filtered writing list has an empty state', () => assert.ok(render([], []).includes('조건에 맞는 글이 없습니다.')));
