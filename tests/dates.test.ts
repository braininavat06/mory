import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { postSchema } from '../src/lib/schema.ts';
import { rssDate } from '../src/lib/dates.ts';
import { fixtureContent } from './fixtures.ts';

const base = fixtureContent().posts[0].data;
test('calendar dates remain strings and accept offset datetimes and reject ambiguous times, Date objects, and invalid days', () => {
  for (const field of ['publishedAt', 'updatedAt'] as const) {
    for (const date of ['2026-01-01', '2026-12-31', '2000-02-29', '2026-10-01T15:42:00+09:00']) {
      assert.equal(postSchema.parse({ ...base, [field]: date })[field], date);
    }
    for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-09-30T15:00:00Z', new Date('2026-10-01')]) {
      assert.equal(postSchema.safeParse({ ...base, [field]: date }).success, false, `${field}: ${date}`);
    }
  }
});
test('RSS serializes the original calendar day at its format boundary', () => {
  assert.equal(rssDate('2026-10-01'), 'Thu, 01 Oct 2026 00:00:00 GMT');
  assert.equal(rssDate('2000-02-29'), 'Tue, 29 Feb 2000 00:00:00 GMT');
});
test('unquoted YAML dates, rendering, sorting, and RSS are identical across host timezones', () => {
  const source = `
    import { fixtureContent } from './tests/fixtures.ts';
    import { readContent } from './src/lib/content.ts';
    import { sortPosts } from './src/lib/listing.ts';
    import { renderWritingItems } from './src/lib/html.ts';
    import { rssDate } from './src/lib/dates.ts';
    const content = fixtureContent();
    content.posts[0].data.publishedAt = '2026-01-01';
    content.posts[1].data.publishedAt = '2025-12-31';
    const posts = content.posts.slice(0, 2);
    console.log(JSON.stringify({
      sourceDates: readContent().posts.map(p => [p.data.publishedAt, p.data.updatedAt]),
      latest: sortPosts(posts, 'latest').map(p => p.data.slug),
      oldest: sortPosts(posts, 'oldest').map(p => p.data.slug),
      html: renderWritingItems(posts, content),
      rss: rssDate('2026-01-01'),
    }));
  `;
  const results = ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Apia'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  for (const result of results) assert.equal(result, results[0]);
  assert.match(results[0], /2026-01-01/);
});
