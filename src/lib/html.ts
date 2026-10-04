import { displayDate } from './dates.ts';
import type { Content, Post } from './content.ts';
import { orderedCategories, publicSeries, publishedPosts } from './content.ts';
import { sortPosts } from './listing.ts';
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function renderWritingItems(posts: Post[], content: Content, categoryId?: string): string {
  if (!posts.length) return '<p class="empty-state">아직 공개된 글이 없습니다.</p>';
  const memberships = new Map<string, { id: string; name: string }[]>();
  for (const series of publicSeries(content)) for (const post of series.posts) {
    const entries = memberships.get(post.data.id) ?? [];
    entries.push({ id: series.id, name: series.name });
    memberships.set(post.data.id, entries);
  }
  return `<ol class="writing-items">${posts.map(({ data: p }) => {
    const series = memberships.get(p.id) ?? [];
    const seriesInfo = series.length ? `<div class="post-series"><span>시리즈:</span> ${series.map(s => `<a href="/series/${escapeHtml(s.id)}/">${escapeHtml(s.name)}</a>`).join(' <span aria-hidden="true">·</span> ')}</div>` : '';
    return `<li><div class="post-meta"><a href="/category/${p.category}/">${escapeHtml(content.categories[p.category].name)}</a></div><h2><a href="/writing/${p.slug}/${categoryId ? `?category=${encodeURIComponent(categoryId)}` : ''}">${escapeHtml(p.title)}</a></h2><p>${escapeHtml(p.description)}</p>${seriesInfo}<div class="post-dates"><time datetime="${escapeHtml(p.publishedAt!)}">${displayDate(p.publishedAt!)}</time></div></li>`;
  }).join('')}</ol>`;
}
export function renderSearch(hasPublishedPosts = true): string {
  return `<mory-search${hasPublishedPosts ? '' : ' data-empty-archive'}><form role="search"><label><span class="sr-only">글 검색</span><input type="search" enterkeyhint="search" name="q" placeholder="제목이나 본문을 검색하세요" autocomplete="off" /></label><button type="submit">검색</button></form><p class="search-status" role="status" aria-live="polite">${hasPublishedPosts ? '공개된 글의 제목과 본문을 검색합니다.' : '아직 공개된 글이 없습니다.'}</p><ol class="search-results"></ol><noscript>검색을 사용하려면 JavaScript가 필요합니다. <a href="/writing/">글 목록</a>에서도 글을 찾을 수 있습니다.</noscript></mory-search>`;
}
export type DynamicKind = 'recent-writing' | 'category-list' | 'series-list' | 'writing-search' | 'writing-list' | 'series-writing';
export function renderDynamic(kind: DynamicKind, content: Content, count = 5, seriesId?: string): string {
  switch (kind) {
    case 'recent-writing': return renderWritingItems(sortPosts(publishedPosts(content), 'latest').slice(0, count), content);
    case 'writing-list': return renderWritingItems(sortPosts(publishedPosts(content), 'latest'), content);
    case 'writing-search': return renderSearch(publishedPosts(content).length > 0);
    case 'category-list': return `<ul class="registry-list category-list">${orderedCategories(content).map(([id, category]) => `<li><a href="/category/${id}/">${escapeHtml(category.name)}</a></li>`).join('')}</ul>`;
    case 'series-list': return `<ul class="registry-list">${publicSeries(content).map(s => `<li><a href="/series/${s.id}/">${escapeHtml(s.name)}</a><span>${s.posts.length}편</span></li>`).join('')}</ul>`;
    case 'series-writing': {
      if (!seriesId || !Object.hasOwn(content.series, seriesId)) throw new Error(`존재하지 않는 시리즈 ID: ${seriesId ?? ''}`);
      const definition = content.series[seriesId];
      const series = publicSeries(content).find(s => s.id === seriesId);
      const title = series ? `<a href="/series/${seriesId}/">${escapeHtml(definition.name)}</a>` : escapeHtml(definition.name);
      return `<section class="series-writing" data-pagefind-ignore><h2>${title}</h2>${renderWritingItems(series?.posts ?? [], content)}</section>`;
    }
  }
}
