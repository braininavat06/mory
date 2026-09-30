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
test('invalid wikilinks and unsafe assets fail with structured diagnostic identifiers', async () => {
  await assert.rejects(renderer.render('[[missing-slug]]', options), error => /존재하지 않는 wikilink slug/.test(String(error)) && (error as { ruleId: string }).ruleId === 'wikilink');
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


test('build pre-validation makes Markdown errors fatal with the filename', async () => {
  const fixture = fixtureContent();
  fixture.posts[0].body = '[[missing-build-reference]]';
  const { validateMarkdown } = await import('../src/lib/validate-markdown.ts');
  await assert.rejects(validateMarkdown(fixture), /src\/content\/posts\/a-place-to-write.md/);
});
