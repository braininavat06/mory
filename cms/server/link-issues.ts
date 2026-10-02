import { inspectMarkdown } from '../../src/lib/validate-markdown.ts';
import type { Content } from '../../src/lib/content.ts';
import type { Store } from './store.ts';
import type { ContentIssue, LinkIssueDocument } from '../shared.ts';

// Read-only inspection shares the public validator and renderer. Link targets
// always use the last public snapshots, not another document's pending edits.
export async function linkIssues(store: Store): Promise<LinkIssueDocument[]> {
  const drafts = store.list();
  function content(publicTargets: boolean): Content {
    const payload = (d: typeof drafts[number]) => publicTargets ? d.published ?? d.value : d.value;
    return {
      posts: drafts.filter(d => d.kind === 'post').map(d => ({ file: d.path, data: payload(d).data as Content['posts'][number]['data'], body: payload(d).body })),
      pages: drafts.filter(d => d.kind === 'page').map(d => ({ file: d.path, key: d.id, data: payload(d).data as Content['pages'][number]['data'], body: payload(d).body })),
      categories: (publicTargets ? drafts.find(d => d.kind === 'categories')?.published?.data : drafts.find(d => d.kind === 'categories')?.value.data) as Content['categories'] ?? {},
      series: Object.fromEntries(drafts.filter(d => d.kind === 'series' && (!publicTargets || d.published)).map(d => { const { id, ...data } = payload(d).data; return [d.id, data]; })) as Content['series'],
    };
  }
  const published = content(true), working = content(false);
  const publicFiles = new Set(drafts.filter(d => d.published).map(d => d.path));
  const publicLinks = new Map<string, LinkIssueDocument['sources'][number]['links']>();
  const workingLinks = new Map<string, LinkIssueDocument['sources'][number]['links']>();
  const collect = (map: typeof publicLinks) => (file: string, link: { target: string; label: string; line: number }) => {
    map.set(file, [...map.get(file) ?? [], { target: link.target, label: link.label, line: link.line }]);
  };
  const publicScan = await inspectMarkdown(published, store.root, {
    entries: [...published.posts, ...published.pages].filter(d => publicFiles.has(d.file)), includePrivate: true, onWikilink: collect(publicLinks),
  });
  const targetDocuments = publicScan.documents.filter(d => published.pages.some(p => p.file === d.file) || published.posts.some(p => p.file === d.file && p.data.status === 'published'));
  const workingScan = await inspectMarkdown(working, store.root, {
    includePrivate: true, targets: published, targetDocuments, onWikilink: collect(workingLinks),
  });
  const results: LinkIssueDocument[] = [];
  for (const draft of drafts.filter(d => d.kind === 'post' || d.kind === 'page')) {
    const sources: LinkIssueDocument['sources'] = [];
    for (const [source, scan, links] of [['작업본', workingScan, workingLinks], ['공개본', publicScan, publicLinks]] as const) {
      const issues: ContentIssue[] = scan.warnings.filter(i => i.file === draft.path).map(i => ({ kind: i.kind ?? 'route', severity: i.severity ?? 'warning', line: i.line, target: i.target, message: i.message }));
      for (const issue of scan.errors.filter(i => i.file === draft.path)) issues.push({ kind: 'markdown', severity: 'error', line: 0, message: issue.message.replace(/^Failed to parse Markdown file "[^"]*":\s*/, '').split(store.root).join('') });
      const unique = [...new Map(issues.map(i => [JSON.stringify(i), i])).values()];
      if (unique.length) sources.push({ source, links: links.get(draft.path) ?? [], issues: unique });
    }
    if (sources.length) results.push({ key: draft.key, title: draft.value.data.title || draft.published?.data.title || '제목 없는 글', kind: draft.kind as 'post' | 'page', status: draft.status, sources });
  }
  return results;
}
