import type { Content, Post } from './content.ts';
import { orderedCategories, publicSeries, publishedPosts } from './content.ts';
import { sortPosts } from './listing.ts';
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function renderWritingItems(posts: Post[], content: Content): string {
  if (!posts.length) return '<p class="empty-state">아직 공개된 글이 없습니다.</p>';
  return `<ol class="writing-items">${posts.map(({ data: p }) => `<li><div class="post-meta"><a href="/category/${p.category}/">${escapeHtml(content.categories[p.category].name)}</a><span>·</span><time datetime="${p.publishedAt!}">${p.publishedAt!}</time>${p.updatedAt ? `<span>· 수정 ${p.updatedAt}</span>` : ''}</div><h2><a href="/writing/${p.slug}/">${escapeHtml(p.title)}</a></h2><p>${escapeHtml(p.description)}</p></li>`).join('')}</ol>`;
}
export function renderSearch(hasPublishedPosts = true): string {
  return `<mory-search${hasPublishedPosts ? '' : ' data-empty-archive'}><form role="search"><label>글 검색<input type="search" name="q" placeholder="제목이나 본문을 검색하세요" autocomplete="off" required /></label><button type="submit">검색</button></form><p class="search-status" role="status" aria-live="polite">${hasPublishedPosts ? '공개된 글의 제목과 본문을 검색합니다.' : '아직 공개된 글이 없습니다.'}</p><ol class="search-results"></ol><noscript>검색을 사용하려면 JavaScript가 필요합니다. <a href="/writing/">Writing 목록</a>에서도 글을 찾을 수 있습니다.</noscript></mory-search>`;
}
export type DynamicKind = 'recent-writing' | 'category-list' | 'series-list' | 'writing-search' | 'writing-list';
export function renderDynamic(kind: DynamicKind, content: Content, count = 5): string {
  switch (kind) {
    case 'recent-writing': return renderWritingItems(sortPosts(publishedPosts(content), 'latest').slice(0, count), content);
    case 'writing-list': return renderWritingItems(sortPosts(publishedPosts(content), 'latest'), content);
    case 'writing-search': return renderSearch(publishedPosts(content).length > 0);
    case 'category-list': return `<ul class="registry-list">${orderedCategories(content).map(([id, category]) => `<li><a href="/category/${id}/">${escapeHtml(category.name)}</a></li>`).join('')}</ul>`;
    case 'series-list': return `<ul class="registry-list">${publicSeries(content).map(s => `<li><a href="/series/${s.id}/">${escapeHtml(s.name)}</a><span>${s.posts.length}편</span></li>`).join('')}</ul>`;
  }
}
