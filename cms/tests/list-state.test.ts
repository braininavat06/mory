import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWritingList, writingListKey } from '../client/list-state.ts';
test('Writing list restores search, status, category and scroll from tab-scoped UI storage', () => {
  const saved = { query: '검색어', filter: '수정 중', category: 'essay', scrollY: 1350 };
  assert.deepEqual(readWritingList({getItem: key => key === writingListKey ? JSON.stringify(saved) : null}), saved);
});
test('missing, blocked or corrupt storage safely uses defaults; invalid fields cannot break the list', () => {
  const fallback = { query: '', filter: '전체', category: '', scrollY: 0 };
  for (const value of [null, '{broken', 'null', 'false']) assert.deepEqual(readWritingList({getItem: () => value}), fallback);
  assert.deepEqual(readWritingList({getItem: () => {throw Error('Blocked');}}), fallback);
  assert.deepEqual(readWritingList({getItem: () => JSON.stringify({query:4,filter:'unknown',category:{},scrollY:-1})}), fallback);
});
