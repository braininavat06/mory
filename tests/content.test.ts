import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { readContent, validateRelations, publicSeries, publishedPosts } from '../src/lib/content.ts';
import type { Content, Post } from '../src/lib/content.ts';
import { postSchema } from '../src/lib/schema.ts';
import { listPages, listUrl } from '../src/lib/listing.ts';
import { assetUrl } from '../src/lib/assets.ts';
import { fixtureContent } from './fixtures.ts';
const original = fixtureContent();
const clone = () => structuredClone(original);

test('all relation conflicts report source paths', () => {
  const cases: [string, (content: Content) => void, RegExp][] = [
    ['id', c => { c.posts[1].data.id = c.posts[0].data.id; }, /duplicate post id/],
    ['slug', c => { c.posts[1].data.slug = c.posts[0].data.slug; }, /duplicate slug/],
    ['category', c => { c.posts[0].data.category = 'missing'; }, /invalid category/],
    ['series membership', c => { c.series['second'] = { name: 'Second', posts: [c.posts[0].data.id] }; }, /duplicate series membership/],
    ['missing series post', c => { c.series['sample-series'].posts.push('01K6F4J0M000000000000000ZZ'); }, /존재하지 않는 post id/],
    ['duplicate aliases', c => { c.posts[1].data.aliases.push(c.posts[0].data.aliases[0]); }, /alias 충돌/],
    ['alias/slug', c => { c.posts[0].data.aliases.push(c.posts[1].data.slug); }, /active slug 충돌/],
    ['reserved routes', c => { c.posts[0].data.slug = 'oldest'; }, /예약 경로/],
  ];
  for (const [name, mutate, message] of cases) {
    const content = clone(); mutate(content);
    const errors = validateRelations(content);
    assert.ok(errors.some(e => message.test(e) && /src\/(content\/posts|data\/series.yaml)/.test(e)), name);
  }
});
test('invalid schema reports filenames through the same reader used by build', () => {
  const root = mkdtempSync(join(tmpdir(), 'mory-validation-'));
  try {
    for (const path of ['src/content/posts', 'src/content/pages', 'src/data']) mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'src/data/categories.yaml'), stringify(original.categories));
    writeFileSync(join(root, 'src/data/series.yaml'), '{}');
    for (const page of original.pages) writeFileSync(join(root, page.file), `---\n${stringify(page.data)}---\n${page.body}`);
    for (const invalid of [{ status: 'private' }, { status: 'published', publishedAt: null }, { id: 'bad' }, { publishedAt: '2026-02-30' }]) {
      writeFileSync(join(root, 'src/content/posts/invalid.md'), `---\n${stringify({ ...original.posts[0].data, ...invalid })}---\nBody`);
      assert.throws(() => readContent(root), /src\/content\/posts\/invalid.md/);
    }
  } finally { rmSync(root, { recursive: true }); }
});
test('dates accept empty draft fields and retain optional updatedAt', () => {
  const draft = original.posts.find(p => p.data.status === 'draft')!;
  assert.equal(draft.data.publishedAt, undefined);
  assert.equal(draft.data.updatedAt, undefined);
  assert.equal(postSchema.safeParse({ ...draft.data, status: 'published' }).success, false);
});
test('43 posts paginate the entire dataset independently for all sorts and categories', () => {
  const posts: Post[] = Array.from({ length: 43 }, (_, i) => ({ file: `fixture-${i}.md`, body: '', data: {
    ...original.posts[0].data, id: `01K6F4J0M00000000000000${String(i).padStart(4, '0')}`, slug: `post-${i}`, aliases: [],
    publishedAt: `2026-${i < 31 ? '01' : '02'}-${String(i < 31 ? i + 1 : i - 30).padStart(2, '0')}`, updatedAt: i === 0 ? '2027-01-01' : undefined,
  } }));
  for (const base of ['/writing/', '/category/sample/']) {
    const pages = listPages(posts, base);
    assert.equal(pages.length, 9);
    for (const sort of ['latest', 'oldest', 'updated'] as const) {
      const group = pages.filter(p => p.sort === sort);
      assert.deepEqual(group.map(p => p.posts.length), [20, 20, 3]);
      assert.equal(new Set(group.flatMap(p => p.posts.map(p => p.data.id))).size, 43);
      assert.equal(group[0].posts[0].data.slug, sort === 'latest' ? 'post-42' : 'post-0');
      assert.equal(listUrl(base, sort, 2), `${base}${sort === 'latest' ? '' : `${sort}/`}page/2/`);
    }
  }
});
test('series keeps registry order and identity while excluding private posts', () => {
  const content = clone();
  const firstId = content.series['sample-series'].posts[0];
  const first = content.posts.find(p => p.data.id === firstId)!;
  first.data.slug = 'renamed'; first.data.title = '새 제목';
  content.series['sample-series'].posts.push(content.posts.find(p => p.data.status === 'draft')!.data.id);
  assert.equal(publicSeries(content)[0].posts[0].data.slug, 'renamed');
  assert.equal(publicSeries(content)[0].posts.length, 2);
  assert.equal(publishedPosts(content).length, 2);
});
test('asset provider changes without editing Markdown; traversal is rejected', () => {
  const id = original.posts[0].data.id;
  assert.equal(assetUrl('image.webp', id, 'https://img.mory.place'), `https://img.mory.place/posts/${id}/image.webp`);
  assert.equal(assetUrl('shared/some image.webp', undefined, '/fixtures'), '/fixtures/shared/some%20image.webp');
  assert.throws(() => assetUrl('../private.webp', id));
  assert.throws(() => assetUrl('image.webp'));
});
