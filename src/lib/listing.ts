import { PAGE_SIZE } from './config.ts';
import type { Post } from './content.ts';
export const SORTS = ['latest', 'oldest', 'updated'] as const;
export type Sort = typeof SORTS[number];
export const SORT_NAMES: Record<Sort, string> = { latest: '최신순', oldest: '오래된순', updated: '최근 수정순' };
export function sortPosts(posts: Post[], sort: Sort): Post[] {
  // Valid YYYY-MM-DD strings sort chronologically without a timezone conversion.
  const date = (post: Post) => (sort === 'updated' ? post.data.updatedAt ?? post.data.publishedAt : post.data.publishedAt) ?? '';
  return [...posts].sort((a, b) => (sort === 'oldest' ? date(a).localeCompare(date(b)) : date(b).localeCompare(date(a))) || a.data.id.localeCompare(b.data.id));
}
export function listUrl(base: string, sort: Sort, page = 1): string {
  return `${base}${sort === 'latest' ? '' : `${sort}/`}${page === 1 ? '' : `page/${page}/`}`;
}
export interface Listing { posts: Post[]; sort: Sort; page: number; totalPages: number; total: number; base: string }
export function listPages(posts: Post[], base: string, pageSize = PAGE_SIZE): Listing[] {
  return SORTS.flatMap(sort => {
    const sorted = sortPosts(posts, sort);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    return Array.from({ length: totalPages }, (_, i) => ({ posts: sorted.slice(i * pageSize, (i + 1) * pageSize), sort,
      page: i + 1, totalPages, total: posts.length, base }));
  });
}
