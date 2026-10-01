import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readContent, publishedPosts, publicSeries } from '../src/lib/content.ts';
import { listPages, listUrl } from '../src/lib/listing.ts';
import { SITE } from '../src/lib/config.ts';
import { rssDate, displayDate } from '../src/lib/dates.ts';
const content = readContent();
const posts = publishedPosts(content);
const html = (route: string) => readFileSync(join('dist', route, 'index.html'), 'utf8');
const rss = readFileSync('dist/rss.xml', 'utf8');
const sitemap = readFileSync('dist/sitemap-0.xml', 'utf8');
let routeCount = 0;
for (const route of ['/', '/about/']) {
  const page = html(route); ++routeCount;
  assert.match(page, /lang="ko"/);
  assert.ok(page.includes(`rel="canonical" href="${SITE}${route}"`));
  assert.doesNotMatch(page, /data-pagefind-body/);
}
for (const post of posts) {
  const route = `/writing/${post.data.slug}/`;
  const page = html(route); ++routeCount;
  assert.match(page, /data-pagefind-body/);
  assert.ok(page.includes(`rel="canonical" href="${SITE}${route}"`));
  assert.ok(rss.includes(`${SITE}${route}`));
  assert.ok(rss.includes(`<pubDate>${rssDate(post.data.publishedAt!)}</pubDate>`));
  assert.ok(page.includes(`<time datetime="${post.data.publishedAt}">${displayDate(post.data.publishedAt!)}</time>`));
  assert.ok(page.includes(`property="article:published_time" content="${post.data.publishedAt}"`));
  if (post.data.updatedAt) assert.ok(page.includes(`<time datetime="${post.data.updatedAt}">${displayDate(post.data.updatedAt)}</time>`));
  for (const alias of post.data.aliases) {
    const compatibility = html(`/writing/${alias}/`); ++routeCount;
    assert.match(compatibility, /http-equiv="refresh"/);
    assert.match(compatibility, /noindex,follow/);
    assert.ok(compatibility.includes(`rel="canonical" href="${SITE}${route}"`));
    assert.doesNotMatch(compatibility, /data-pagefind-body/);
    assert.ok(!sitemap.includes(`${SITE}/writing/${alias}/`));
  }
}
for (const post of content.posts.filter(p => p.data.status !== 'published')) {
  assert.ok(!existsSync(`dist/writing/${post.data.slug}/index.html`));
  assert.ok(!rss.includes(`${SITE}/writing/${post.data.slug}/`));
}
const listings = [
  ...listPages(posts, '/writing/'),
  ...Object.keys(content.categories).flatMap(id => listPages(posts.filter(p => p.data.category === id), `/category/${id}/`)),
];
for (const listing of listings) {
  const route = listUrl(listing.base, listing.sort, listing.page);
  const page = html(route); ++routeCount;
  const slugs = [...page.matchAll(/<h2><a href="\/writing\/([^/]+)\/">/g)].map(match => match[1]);
  assert.deepEqual(slugs, listing.posts.map(post => post.data.slug), route);
  assert.doesNotMatch(page, /data-pagefind-body/);
  if (listing.page > 1) assert.ok(page.includes(`rel="prev" href="${listUrl(listing.base, listing.sort, listing.page - 1)}"`));
  if (listing.page < listing.totalPages) assert.ok(page.includes(`rel="next" href="${listUrl(listing.base, listing.sort, listing.page + 1)}"`));
}
for (const series of publicSeries(content)) {
  const page = html(`/series/${series.id}/`); ++routeCount;
  assert.deepEqual([...page.matchAll(/<h2><a href="\/writing\/([^/]+)\/">/g)].map(m => m[1]), series.posts.map(p => p.data.slug));
}
assert.ok(existsSync('dist/pagefind/pagefind.js'));
const index = JSON.parse(readFileSync('dist/pagefind/pagefind-entry.json', 'utf8')) as { languages: Record<string, { page_count: number }> };
assert.equal(Object.values(index.languages).reduce((sum, lang) => sum + lang.page_count, 0), posts.length);
assert.ok(!existsSync('public/CNAME') && !existsSync('dist/CNAME'));

assert.ok(existsSync('dist/.nojekyll'));
console.log(`정적 결과 검증 완료: HTML ${routeCount}개, RSS, sitemap, aliases, 모든 정렬/페이지네이션, Pagefind ${posts.length}개 글.`);
