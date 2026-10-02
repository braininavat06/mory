import { timestampValue } from './dates.ts';
import { PAGE_SIZE } from './config.ts';
import type { Post } from './content.ts';
export const SORTS = ['latest', 'oldest'] as const;
export type Sort = typeof SORTS[number];
export const SORT_NAMES: Record<Sort, string> = { latest: '최신순', oldest: '오래된순' };
export function sortPosts(posts: Post[], sort: Sort): Post[] {
  // Valid YYYY-MM-DD strings sort chronologically without a timezone conversion.
  const date = (post: Post) => post.data.publishedAt ?? '';
  return [...posts].sort((a, b) => (sort === 'oldest' ? timestampValue(date(a)) - timestampValue(date(b)) : timestampValue(date(b)) - timestampValue(date(a))) || a.data.id.localeCompare(b.data.id));
}
export function adjacentPosts(posts: Post[], id: string, category?: string) {
  const ordered = sortPosts(posts.filter(post => post.data.status === 'published' && (!category || post.data.category === category)), 'oldest');
  const index = ordered.findIndex(post => post.data.id === id);
  return { previous: index > 0 ? ordered[index - 1] : undefined, next: index >= 0 ? ordered[index + 1] : undefined };
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

// Retired sort URLs retain their page number, but always lead to latest order.
export function retiredSortPages(posts: Post[], base: string) {
  return listPages(posts, base).filter(listing => listing.sort === 'latest').map(listing => ({
    source: `${base}updated/${listing.page === 1 ? '' : `page/${listing.page}/`}`,
    destination: listUrl(base, 'latest', listing.page),
  }));
}
