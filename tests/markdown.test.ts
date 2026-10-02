import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMarkdownOptions } from '../src/markdown/pipeline.ts';
import { fixtureContent } from './fixtures.ts';
const content = fixtureContent();
const markdownOptions = createMarkdownOptions(content);
const renderer = await markdownOptions.processor.createRenderer(markdownOptions);
const post = content.posts.find(p => p.data.slug === 'a-place-to-write')!;
const options = { fileURL: pathToFileURL(resolve(post.file)), frontmatter: post.data };
const pageOptions = { fileURL: pathToFileURL(resolve('src/content/pages/home.md')) };

test('GFM, math, highlight, callouts, wikilinks, local media, footnotes and code render together', async () => {
  const { code, metadata } = await renderer.render(post.body, options);
  for (const match of [/class="callout callout-note"/, /<mark>다시 읽을 이유<\/mark>/, /href="\/writing\/markdown-notes\/"/, /<table>/, /type="checkbox"/, /<del>/, /class="katex"/, /data-footnote-ref/, /class="astro-code/, /<video controls/, /width="600"/, /posts\/01K6F4J0M00000000000000001\/image.webp/]) assert.match(code, match);
  assert.ok(metadata.headings.some(h => h.depth === 2));
});
test('only standalone raw YouTube URLs embed; authored links and unsupported URLs stay links', async () => {
  const { code } = await renderer.render('https://youtu.be/jfKfPfyJRdk\n\n[영상 보기](https://youtu.be/jfKfPfyJRdk)\n\nhttps://example.com/video', options);
  assert.equal((code.match(/<iframe/g) ?? []).length, 1);
  assert.match(code, /youtube-nocookie.com\/embed\/jfKfPfyJRdk/);
  assert.match(code, /<a href="https:\/\/youtu.be\/jfKfPfyJRdk">영상 보기<\/a>/);
  assert.match(code, /<a href="https:\/\/example.com\/video"/);
});
test('extension syntax inside code or normal links remains unchanged', async () => {
  const { code } = await renderer.render('`[[missing-slug]] ==code==`\n\n```text\n::writing-search\n![[missing.mp4]]\n```\n\n[==ordinary link==](https://example.com)', options);
  assert.doesNotMatch(code, /<mark>|<mory-search>|<video/);
  assert.match(code, /\[\[missing-slug\]\]/);
});
test('missing wikilinks degrade to text while unsafe assets still fail', async () => {
  const { code } = await renderer.render('[[missing-slug]] [[missing-slug|표시 제목]]', options);
  assert.match(code, /missing-slug/); assert.match(code, /표시 제목/); assert.doesNotMatch(code, /href=/);
  await assert.rejects(renderer.render('![[../image.webp]]', options), /잘못된 첨부파일 경로/);
});
test('all five dynamic blocks work in pages and only count is supported', async () => {
  const { code } = await renderer.render('::recent-writing{count=1}\n\n::category-list\n\n::series-list\n\n::writing-search\n\n::writing-list', pageOptions);
  assert.match(code, /<mory-search>/);
  assert.match(code, /\/category\/sample\//);
  assert.match(code, /\/series\/sample-series\//);
  assert.equal((code.match(/class="writing-items"/g) ?? []).length, 2);
  assert.doesNotMatch(code, /draft-example|archived-example/);
  await assert.rejects(renderer.render('::recent-writing{limit=5}', pageOptions), /지원하지 않는 dynamic block 옵션/);
});


test('series-writing works in posts and pages, preserves complete series order and excludes private/outside posts', async () => {
  const fixture = fixtureContent();
  const extra = Array.from({ length: 23 }, (_, i) => ({ file: `src/content/posts/series-${i}.md`, body: '', data: { ...fixture.posts[0].data, id: `01K6F4J0M000000000000000${String(i + 10).padStart(3, '0')}`, slug: `series-${i}`, title: `시리즈 ${i}`, aliases: [] } }));
  fixture.posts.push(...extra);
  fixture.series['sample-series'].name = '이름 <변경>';
  fixture.series['sample-series'].posts = [fixture.posts[1].data.id, ...extra.map(p => p.data.id).reverse(), fixture.posts[2].data.id, fixture.posts[3].data.id];
  const options = createMarkdownOptions(fixture);
  const custom = await options.processor.createRenderer(options);
  const expected = ['markdown-notes', ...extra.map(p => p.data.slug).reverse()];
  for (const location of [pageOptions, { fileURL: pathToFileURL(resolve(fixture.posts[0].file)), frontmatter: fixture.posts[0].data }]) {
    const { code } = await custom.render('::series-writing{id=sample-series}', location);
    assert.match(code, /이름 (?:&lt;|&#x3C;)변경(?:&gt;|>)/);
    assert.doesNotMatch(code, /<변경>/);
    assert.match(code, /data-pagefind-ignore/);
    assert.deepEqual([...code.matchAll(/<h2><a href="\/writing\/([^/]+)\/">/g)].map(m => m[1]), expected);
    assert.doesNotMatch(code, /draft-example|archived-example|a-place-to-write/);
  }
});
test('series-writing validates IDs/options, handles empty public series, and stays literal inside code', async () => {
  for (const invalid of ['::series-writing', '::series-writing{id=missing}', '::series-writing{id=sample-series,count=2}', '::series-writing{id=../bad}']) {
    await assert.rejects(renderer.render(invalid, pageOptions), error => /시리즈/.test(String(error)) && (error as { ruleId: string }).ruleId === 'dynamic-block');
  }
  await assert.rejects(renderer.render('::writing-list', options), /Pages/);
  const { code: literal } = await renderer.render('`::series-writing{id=missing}`\n\n```text\n::series-writing{id=missing}\n```', options);
  assert.doesNotMatch(literal, /class="series-writing"/);
  const fixture = fixtureContent(); fixture.series['sample-series'].posts = [fixture.posts[2].data.id, fixture.posts[3].data.id];
  const config = createMarkdownOptions(fixture), custom = await config.processor.createRenderer(config);
  const { code } = await custom.render('::series-writing{id=sample-series}', pageOptions);
  assert.match(code, /샘플 시리즈/); assert.match(code, /아직 공개된 글이 없습니다/);
  assert.doesNotMatch(code, /href="\/series\/sample-series\/"|\/writing\//);
});
test('build pre-validation makes Markdown errors fatal with the filename', async () => {
  const fixture = fixtureContent();
  fixture.posts[0].body = '![[../unsafe.webp]]';
  const { validateMarkdown } = await import('../src/lib/validate-markdown.ts');
  await assert.rejects(validateMarkdown(fixture), /src\/content\/posts\/a-place-to-write.md/);
});

test('managed images resolve from stable post/page owner context without runtime, DB, or R2 calls',async()=>{
 const filename='mory-asset-01K6F4J0M000000000000000ZZ.png';
 const postHtml=(await renderer.render(`![[${filename}|600]]`,options)).code;
 assert.match(postHtml,new RegExp(`https://img.mory.place/posts/${post.data.id}/${filename}`));assert.match(postHtml,/width="600"/);
 const pageHtml=(await renderer.render(`![[${filename}]]`,pageOptions)).code;
 assert.match(pageHtml,new RegExp(`https://img.mory.place/pages/home/${filename}`));
 await assert.rejects(renderer.render('![[mory-asset-not-a-ulid.png]]',options),/이미지 참조/);
});
