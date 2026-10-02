import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMarkdownOptions } from '../../src/markdown/pipeline.ts';
import { readContent } from '../../src/lib/content.ts';
import sanitizeHtml from 'sanitize-html';
import { escapeHtml } from '../../src/lib/html.ts';
import { displayDate } from '../../src/lib/dates.ts';
import type { Store } from './store.ts';
import { CmsError } from '../shared.ts';
import type { Payload } from '../shared.ts';
import { Assets } from './assets.ts';
import { rehypePreviewSource } from './preview-source.ts';

export async function renderPreview(store: Store, key: string, value: Payload, theme: string) {
  const row = store.get(key), content = readContent(store.root);
  content.posts = store.list().filter(d => d.kind === 'post' && d.published).map(d => ({ file: d.path, data: d.published!.data as typeof content.posts[number]['data'], body: d.published!.body }));
  content.categories = store.get('categories:registry').published!.data as typeof content.categories;
  content.series = Object.fromEntries(store.list().filter(d => d.kind === 'series' && d.published).map(d => { const { id, ...data } = d.published!.data; return [d.id, data]; })) as typeof content.series;
  if (row.kind === 'post') {
    const post = { file: row.path, body: value.body, data: value.data as typeof content.posts[number]['data'] };
    const index = content.posts.findIndex(p => p.data.id === row.id);
    if (index >= 0) content.posts[index] = post; else content.posts.push(post);
  }
  // Draft dimensions come from the same immutable asset metadata that publish
  // writes into frontmatter; the static site never needs SQLite or R2.
  const dimensions = Object.fromEntries((store.db.prepare('SELECT filename,width,height FROM assets WHERE owner_type=? AND owner_id=?').all(row.kind,row.id) as {filename:string;width:number;height:number}[]).map(a=>[a.filename,{width:a.width,height:a.height}]));
  value = {...value,data:{...value.data,imageDimensions:{...value.data.imageDimensions,...dimensions}}};
  if(row.kind==='post') { const post=content.posts.find(p=>p.data.id===row.id)!; post.data=value.data as typeof post.data; }
  else if(row.kind==='page') content.pages=content.pages.map(p=>p.key===row.id? {...p,data:value.data as typeof p.data,body:value.body}:p);
  const assets = new Assets(store);
  const published = new Set(row.published?.body.includes('mory-asset-') ? await assets.references(row, row.published) : []);
  const options = createMarkdownOptions(content, [rehypePreviewSource], undefined, { assetResolver: (filename,owner) => assets.preview(filename,owner,published) });
  const renderer = await options.processor.createRenderer(options);
  let rendered;
  try { rendered = await renderer.render(value.body, { fileURL: pathToFileURL(resolve(store.root, row.path)), frontmatter: value.data }); }
  catch(error) { if (/::alt|::caption|이미지 설명|이미지 alt|이미지 caption/.test(String(error))) throw new CmsError(400, (error instanceof Error ? error.message : String(error)).replaceAll(store.root + '/', '')); if (String(error).includes('미리보기 이미지 파일이 없습니다.')) throw new CmsError(400, '미리보기 이미지 파일이 없습니다. 이 문서에 이미지를 다시 업로드해 주세요.'); throw error; }
  const safeBody = sanitizeHtml(rendered.code, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'mory-search', 'mark', 'input', 'button', 'form', 'label', 'video', 'source', 'iframe', 'details', 'summary', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup', 'mfrac', 'mspace', 'mtext', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'msqrt', 'mroot', 'mpadded', 'menclose', 'img'],
    allowedAttributes: { '*': ['class', 'id', 'style', 'role', 'aria-*', 'data-*'], a: ['href', 'title'], input: ['type', 'name', 'checked', 'disabled', 'placeholder', 'autocomplete', 'required'], form: ['role'], button: ['type'], img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'], video: ['controls', 'preload', 'width'], source: ['src', 'type'], iframe: ['src', 'title', 'loading', 'allow', 'allowfullscreen', 'referrerpolicy'], math: ['xmlns', 'display'], annotation: ['encoding'] },
    allowedIframeHostnames: ['www.youtube-nocookie.com'], allowedSchemes: ['http', 'https', 'mailto'],
  });
  const headings = rendered.metadata.headings.filter(h => [2, 3].includes(h.depth) && h.slug !== 'footnote-label');
  const title = escapeHtml(value.data.title ?? '제목 없는 글');
  const toc = headings.length ? `<aside class="toc"><details data-toc><summary>목차 <span class="toc-expand">펼치기 +</span><span class="toc-collapse">접기 −</span></summary><nav aria-label="글 목차"><ol>${headings.map(h => `<li class="${h.depth === 3 ? 'toc-subheading' : ''}"><a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></nav></details></aside>` : '';
  const dates = value.data.publishedAt ? `게시 ${escapeHtml(displayDate(value.data.publishedAt))}${value.data.updatedAt ? ` · 수정 ${escapeHtml(displayDate(value.data.updatedAt))}` : ''}` : '미게시 초안';
  return `<!doctype html><html lang="ko" data-theme="${theme === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preview-assets/style.css"><title>${title} · 미리보기</title></head><body>${row.kind === 'post' ? `<main class="post-grid ${headings.length ? 'with-toc' : ''}"><article class="post-content"><header class="post-heading"><p class="eyebrow">${escapeHtml(content.categories[value.data.category]?.name ?? '')}</p><h1>${title}</h1><p class="post-meta">${dates}</p></header><div class="prose post-body">${safeBody}</div></article>${toc}</main>` : `<main class="page-content prose ${row.id === 'home' ? 'home-content' : ''}">${safeBody}</main>`}<button type="button" class="back-to-top" data-back-to-top hidden aria-label="맨 위로 가기">↑ 맨 위로</button><script type="module" src="/preview-assets/preview.js"></script></body></html>`;
}
