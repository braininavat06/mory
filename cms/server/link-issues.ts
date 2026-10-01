import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownOptions } from '../../src/markdown/pipeline.ts';
import type { Content } from '../../src/lib/content.ts';
import type { Store } from './store.ts';
import type { LinkIssueDocument } from '../shared.ts';

// Use the same Markdown AST extension as publishing and preview. Code blocks,
// inline code, media embeds and ordinary links are not wikilink references.
export async function linkIssues(store: Store): Promise<LinkIssueDocument[]> {
  const drafts = store.list();
  const results = new Map<string, LinkIssueDocument>();
  for (const source of ['작업본', '공개본'] as const) {
    const payload = (d: typeof drafts[number]) => source === '작업본' ? d.value : d.published;
    const content: Content = {
      posts: drafts.filter(d => d.kind === 'post' && payload(d)).map(d => ({ file: d.path, data: payload(d)!.data as Content['posts'][number]['data'], body: payload(d)!.body })),
      pages: [], categories: {}, series: {},
    };
    content.categories = (source === '작업본' ? drafts.find(d => d.kind === 'categories')?.value.data : drafts.find(d => d.kind === 'categories')?.published?.data) as Content['categories'] ?? {};
    content.series = Object.fromEntries(drafts.filter(d => d.kind === 'series' && payload(d)).map(d => { const { id, ...data } = payload(d)!.data; return [d.id, data]; })) as Content['series'];
    let links: LinkIssueDocument['sources'][number]['links'] = [];
    const options = createMarkdownOptions(content, [], link => links.push(link));
    const renderer = await options.processor.createRenderer(options);
    for (const draft of drafts.filter(d => (d.kind === 'post' || d.kind === 'page') && payload(d))) {
      links = [];
      const value = payload(draft)!;
      try { await renderer.render(value.body, { fileURL: pathToFileURL(resolve(store.root, draft.path)), frontmatter: value.data }); }
      catch { /* Other Markdown errors remain enforced by publish validation. */ }
      if (!links.length) continue;
      const document: LinkIssueDocument = results.get(draft.key) ?? { key: draft.key, title: draft.value.data.title || draft.published?.data.title || '제목 없는 글', kind: draft.kind as 'post' | 'page', status: draft.status, sources: [] };
      document.sources.push({ source, links }); results.set(draft.key, document);
    }
  }
  return [...results.values()];
}
