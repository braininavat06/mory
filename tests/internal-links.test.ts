import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureContent } from './fixtures.ts';
import { validateMarkdown } from '../src/lib/validate-markdown.ts';
import { createMarkdownOptions } from '../src/markdown/pipeline.ts';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
async function diagnostics(body:string,targetBody='## Target heading\n\n## Target heading') {
 const content=fixtureContent();content.posts[0].body=body;content.posts[1].body=targetBody;
 return validateMarkdown(content);
}
test('valid internal relative/root/same-domain, pages, categories, series, aliases and duplicate heading suffixes',async()=>{
 const warnings=await diagnostics('[target](../markdown-notes/#target-heading) [duplicate](../markdown-notes/#target-heading-1) [self](#self) [top](#top) [alias](/writing/first-note/#self) [page](/about/#about) [home](https://mory.place/#home) [listing](/writing/oldest/) [category](/category/sample/) [series](/series/sample-series/) [index](/writing/markdown-notes/index.html#target-heading)\n\n## Self');
 assert.deepEqual(warnings,[]);
});
test('broken routes, fragments and nonpublic references report source filename and readable warning without blocking',async()=>{
 const warnings=await diagnostics('[missing](/writing/no-post/) [page](/missing/) [anchor](../markdown-notes/#missing) [self](#absent) [draft](/writing/draft-example/) [archive](/writing/archived-example/) [relative](wrong/path)');
 assert.equal(warnings.length,7);assert.ok(warnings.every(w=>w.file.endsWith('a-place-to-write.md')&&w.line>0));assert.equal(warnings.filter(w=>w.message.includes('초안·보관')).length,2);assert.equal(warnings.filter(w=>w.message.includes('앵커가 없습니다')).length,2);
});
test('external links, mailto, code literals and existing public files have no network-dependent checks',async()=>{
 assert.deepEqual(await diagnostics('[external](https://invalid.example/never) [mail](mailto:a@example.com) [robots](/robots.txt)\n\n`[literal](/missing)`\n\n```md\n[missing](/missing)\n```'),[]);
});
test('wikilinks via aliases target canonical slug; private/missing references degrade and warn',async()=>{
 const content=fixtureContent();content.posts[0].body='[[first-note|자기 글]] [[draft-example]] [[archived-example]] [[missing]]';content.posts[1].body='';
 const options=createMarkdownOptions(content);const renderer=await options.processor.createRenderer(options);const result=await renderer.render(content.posts[0].body,{fileURL:pathToFileURL(resolve(content.posts[0].file))});
 assert.match(result.code,/href="\/writing\/a-place-to-write\/"/);assert.doesNotMatch(result.code,/href="[^"]*(first-note|draft-example|archived-example|missing)/);
 const warnings=await validateMarkdown(content);assert.equal(warnings.length,3);
});
test('raw HTML links participate in diagnostics and ordinary external links keep their existing same-tab policy',async()=>{
 const content=fixtureContent();content.posts[0].body='<a href="/missing/" target="_blank">missing</a>\n\n<a href="https://example.com" target="_blank">external</a>';content.posts[1].body='';
 const options=createMarkdownOptions(content);const renderer=await options.processor.createRenderer(options);const result=await renderer.render(content.posts[0].body,{fileURL:pathToFileURL(resolve(content.posts[0].file))});
 assert.match(result.code,/href="https:\/\/example.com"/);assert.equal((await validateMarkdown(content)).length,1);
});
test('explicit duplicate HTML IDs warn while normal repeated headings have distinct anchor IDs',async()=>{
 const warnings=await diagnostics('<span id="duplicate">a</span>\n\n<span id="duplicate">b</span>');assert.equal(warnings.length,1);assert.match(warnings[0].message,/중복 HTML 앵커/);
});
