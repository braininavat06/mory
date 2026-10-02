import { visit } from 'unist-util-visit';
import type { Root, Parent, PhrasingContent, Text } from 'mdast';
import type { VFile } from 'vfile';
import { readContent } from '../lib/content.ts';
import type { Content } from '../lib/content.ts';
import { resolveAssetUrl } from '../lib/assets.ts';
import type { AssetOwner } from '../lib/assets.ts';
import { escapeHtml } from '../lib/html.ts';

const callouts = {
  note: { label: '참고', icon: 'ⓘ' },
  tip: { label: '팁', icon: '✓' },
  important: { label: '중요', icon: '!' },
  warning: { label: '주의', icon: '△' },
};
function youtubeId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    const host = url.hostname.replace(/^www\./, '');
    const id = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'm.youtube.com'].includes(host)
      ? url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1] : undefined;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch { return; }
}
export interface BrokenWikilink { target: string; label: string; line: number }
export function remarkObsidian(options: { content?: Content; onBrokenWikilink?: (link: BrokenWikilink) => void; onEmbed?: (filename: string) => void; assetResolver?: (filename: string, owner?: AssetOwner) => string } = {}) {
  return (tree: Root, file: VFile) => {
    const content = options.content ?? readContent();
    const path = (file.path ?? '').replace(/\\/g, '/');
    const current = content.posts.find(p => path.endsWith(p.file));
    const page = content.pages.find(p => path.endsWith(p.file));
    const owner: AssetOwner | undefined = current ? { type: 'post', id: current.data.id } : page && ['home', 'about'].includes(page.key) ? { type: 'page', id: page.key } : undefined;
    const source = String(file.value);
    visit(tree, 'paragraph', (node, index, parent) => {
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset).trim() : '';
      // Only a literal URL paragraph qualifies, never an authored Markdown link.
      const id = /^https?:\/\/\S+$/.test(raw) ? youtubeId(raw) : undefined;
      if (id && parent && typeof index === 'number') {
        parent.children[index] = { type: 'html', value: `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube 영상" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` };
      }
    });
    visit(tree, 'blockquote', node => {
      const first = node.children[0];
      if (first?.type !== 'paragraph' || first.children[0]?.type !== 'text') return;
      const text = first.children[0];
      const marker = /^\[!(note|tip|important|warning)\](?:[ \t]+([^\n]*))?(?:\n|$)/i.exec(text.value);
      if (!marker) return;
      const type = marker[1].toLowerCase() as keyof typeof callouts;
      const { label, icon } = callouts[type];
      text.value = text.value.slice(marker[0].length);
      if (!text.value) first.children.shift();
      if (!first.children.length) node.children.shift();
      node.data = { hName: 'aside', hProperties: { className: ['callout', `callout-${type}`], 'aria-label': label } };
      node.children.unshift({ type: 'html', value: `<p class="callout-label"><span aria-hidden="true">${icon}</span> ${escapeHtml(marker[2]?.trim() || label)}</p>` });
    });
    function expand(text: Text): PhrasingContent[] {
      const result: PhrasingContent[] = [];
      const regex = /!?\[\[([^\]\n]+)\]\]|==([^=\n]+)==/g;
      let previous = 0;
      for (const match of text.value.matchAll(regex)) {
        if (match.index! > previous) result.push({ type: 'text', value: text.value.slice(previous, match.index) });
        if (match[2] !== undefined) {
          result.push({ type: 'html', value: `<mark>${escapeHtml(match[2])}</mark>` });
        } else {
          const [target, label] = match[1].split('|');
          if (match[0].startsWith('!')) {
            const extension = target.split('.').pop()?.toLowerCase();
            if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm'].includes(extension ?? '')) file.fail(`지원하지 않는 첨부파일 형식: ${target}`, text.position, 'mory:asset');
            if (label !== undefined && !/^[1-9]\d*$/.test(label)) file.fail(`첨부파일 너비는 양의 정수여야 합니다: ${match[0]}`, text.position, 'mory:asset');
            let url: string;
            try { options.onEmbed?.(target); url = (options.assetResolver ?? resolveAssetUrl)(target, owner); }
            catch (error) { file.fail(error instanceof Error ? error.message : String(error), text.position, 'mory:asset'); }
            const width = label ? ` width="${label}"` : '';
            const name = target.split('/').pop()!;
            result.push({ type: 'html', value: ['mp4', 'webm'].includes(extension!)
              ? `<video controls preload="metadata"${width} aria-label="${escapeHtml(name)}"><source src="${escapeHtml(url!)}" type="video/${extension}"><a href="${escapeHtml(url!)}">${escapeHtml(name)} 다운로드</a></video>`
              : `<img src="${escapeHtml(url!)}" alt="${escapeHtml(name)}"${width} loading="lazy" decoding="async" />` });
          } else {
            const post = content.posts.find(p => p.data.slug === target);
            if (!post) {
              file.message(`존재하지 않는 wikilink slug: ${target}; 텍스트로 표시합니다.`, text.position, 'mory:wikilink');
              options.onBrokenWikilink?.({ target, label: label || target, line: (text.position?.start.line ?? 1) + text.value.slice(0, match.index).split('\n').length - 1 });
              result.push({ type: 'text', value: label || target });
            } else if (post.data.status !== 'published') {
              file.message(`비공개 글을 참조하는 wikilink: ${target}; 공개 링크를 생성하지 않습니다.`, text.position, 'mory:wikilink');
              result.push({ type: 'text', value: label || target });
            } else result.push({ type: 'link', url: `/writing/${target}/`, children: [{ type: 'text', value: label || target }] });
          }
        }
        previous = match.index! + match[0].length;
      }
      if (previous < text.value.length) result.push({ type: 'text', value: text.value.slice(previous) });
      return result;
    }
    function walk(parent: Parent) {
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        if (child.type === 'text') {
          const replacement = expand(child);
          parent.children.splice(index, 1, ...replacement);
          index += replacement.length - 1;
        } else if ('children' in child && !['link', 'linkReference', 'image', 'imageReference'].includes(child.type)) walk(child as Parent);
      }
    }
    walk(tree);
  };
}
