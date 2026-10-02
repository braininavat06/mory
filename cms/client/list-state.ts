export interface WritingListState { query: string; filter: string; category: string; scrollY: number }
export const writingListKey = 'mory-writing-list';
const filters = ['전체', '초안', '게시됨', '수정 중', '보관됨'];
export function readWritingList(storage: Pick<Storage, 'getItem'>): WritingListState {
  const fallback = { query: '', filter: '전체', category: '', scrollY: 0 };
  try {
    const value = JSON.parse(storage.getItem(writingListKey) ?? 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      query: typeof value.query === 'string' ? value.query : '',
      filter: filters.includes(value.filter) ? value.filter : '전체',
      category: typeof value.category === 'string' ? value.category : '',
      scrollY: typeof value.scrollY === 'number' && Number.isFinite(value.scrollY) && value.scrollY >= 0 ? value.scrollY : 0,
    };
  } catch { return fallback; }
}
