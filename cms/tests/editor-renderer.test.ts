import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorState } from '@codemirror/state';
import { writeFixtureContent } from '../../tests/fixtures.ts';
import { Store } from '../server/store.ts';
import { renderPreview } from '../server/preview.ts';
import { createMarkdownOptions } from '../../src/markdown/pipeline.ts';
import { readContent } from '../../src/lib/content.ts';
import { calloutMarkdown, tableMarkdown, wikiLink, markdownLink, imageMarkdown, dynamicMarkdown, codeMarkdown, format } from '../client/editor-commands.ts';
test('authoring commands render through shared preview/public pipeline without an editor dialect',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mory-editor-renderer-'));writeFixtureContent(root);const store=new Store(root,join(root,'runtime'));
 try{
 const content=readContent(root),post=content.posts[0],row=store.get(`post:${post.data.id}`);
 const footnote=EditorState.create({doc:'각주 문장'});const footnoteBody=footnote.update(format(footnote,'footnote',{from:5,to:5})).state.doc.toString();
 const body=['## 소제목','**굵게** *기울임* ~~취소선~~ ==강조==',calloutMarkdown('tip','제목','내용'),tableMarkdown(2,2),wikiLink('markdown-notes','다음 글'),markdownLink('소개','/about/'),codeMarkdown('const value = 1;','typescript').text,'$E=mc^2$',imageMarkdown({filename:'image.webp',width:'600',alt:'대체 설명',caption:'**사진 설명** [링크](https://example.com)'}),footnoteBody,dynamicMarkdown('series-writing',5,'sample-series',false)].join('\n\n');
 const value={...row.value,body};const options=createMarkdownOptions(content),renderer=await options.processor.createRenderer(options);
 const pub=(await renderer.render(body,{fileURL:pathToFileURL(resolve(root,row.path)),frontmatter:value.data})).code;
 const preview=await renderPreview(store,row.key,value,'light');
 for(const pattern of [/<strong>굵게<\/strong>/,/<del>취소선<\/del>/,/<mark>강조<\/mark>/,/<aside[^>]*callout-tip/,/<table(?: |>)/,/href="\/writing\/markdown-notes\/"/,/alt="대체 설명"/,/width="600"/,/<figcaption><strong>사진 설명<\/strong>/,/data-footnote-ref/,/class="dynamic-block"/,/katex/]){assert.match(pub,pattern);assert.match(preview,pattern);}
 const page=store.get('page:home');const home={...page.value,body:['# Mory',...['recent-writing','category-list','series-list','writing-search','writing-list'].map(kind=>dynamicMarkdown(kind,3,'',true))].join('\n\n')};assert.match(await renderPreview(store,page.key,home,'dark'),/mory-search/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
