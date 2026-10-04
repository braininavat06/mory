import { visit } from 'unist-util-visit';
import type { Root, Parent, PhrasingContent, Text } from 'mdast';
import type { VFile } from 'vfile';
import { readContent } from '../lib/content.ts';
import type { Content } from '../lib/content.ts';
import { resolveAssetUrl } from '../lib/assets.ts';
import type { AssetOwner } from '../lib/assets.ts';
import { escapeHtml } from '../lib/html.ts';

import { callouts, youtubeId, imageDirective } from './syntax.ts';
export interface BrokenWikilink { target: string; label: string; line: number }
export function remarkObsidian(this: any, options: { content?: Content; wikilinkContent?:Content; onBrokenWikilink?: (link: BrokenWikilink) => void; onEmbed?: (filename: string) => void; onAssetUrl?: (url: string) => void; onAssetHtml?: (html: string) => void; assetResolver?: (filename: string, owner?: AssetOwner) => string } = {}) {
  const parseInline = (source: string) => { const first = (this.parse(source) as Root).children[0]; return first?.type === 'paragraph' ? first.children : [{type:'text' as const,value:source}]; };
  return (tree: Root, file: VFile) => {
    const content = options.content ?? readContent();
    const path = (file.path ?? '').replace(/\\/g, '/');
    const current = content.posts.find(p => path.endsWith(p.file));
    const page = content.pages.find(p => path.endsWith(p.file));
    const owner: AssetOwner | undefined = current ? { type: 'post', id: current.data.id } : page && ['home', 'about'].includes(page.key) ? { type: 'page', id: page.key } : undefined;
    const source = String(file.value);
    visit(tree,'image', node => { options.onAssetUrl?.(node.url); });
    visit(tree,'html', node => { options.onAssetHtml?.(node.value); });
    const dimensions = current?.data.imageDimensions ?? page?.data.imageDimensions ?? {};
    function imageHtml(target: string, label?: string, alt = '') {
      let url: string;
      try { options.onEmbed?.(target); url = (options.assetResolver ?? resolveAssetUrl)(target, owner); }
      catch(error) { file.fail(error instanceof Error ? error.message : String(error), undefined, 'mory:asset'); }
      const d = dimensions[target], width = label ? Number(label) : d?.width;
      const height = d && width ? Math.max(1,Math.round(d.height * width / d.width)) : undefined;
      return `<img src="${escapeHtml(url!)}" alt="${escapeHtml(alt)}"${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''} loading="lazy" decoding="async" />`;
    }
    function plain(nodes: any[]): string { return nodes.map(n => n.type === 'html' ? '' : n.type === 'image' ? n.alt ?? '' : n.children ? plain(n.children) : n.value ?? '').join(''); }
    function directive(line: string) {
      try { return imageDirective(line); }
      catch (error) { file.fail((error as Error).message, undefined, 'mory:image-metadata'); }
    }
    visit(tree, 'paragraph', (node, index, parent) => {
      const raw = node.position ? source.slice(node.position.start.offset,node.position.end.offset).trim() : '';
      const lines = raw.split(/\r?\n/).map(l=>l.replace(/^(?:[ \t]*>[ \t]?)+/,'').trimStart());
      const isDirective = (line: string) => /^::(?:alt|caption)(?:\[|$)/.test(line);
      if (!lines.some(isDirective) || !parent || typeof index !== 'number') return;
      const replacement: any[] = [], pending: string[] = [];
      const flush = () => {
        if(!pending.length) return;
        const raw = pending.splice(0).join('\n');
        for(const child of (this.parse(raw) as Root).children) { child.position=undefined; child.data={...child.data,moryRaw:raw}; replacement.push(child); }
      };
      for(let line=0;line<lines.length;line++) {
        if(isDirective(lines[line])) file.fail('::alt와 ::caption은 이미지 바로 다음 줄에 붙여 쓰세요. 사이에 빈 줄을 넣지 마세요.',node.position,'mory:image-metadata');
        const embed = /^!\[\[([^\]\n]+)\]\]$/.exec(lines[line]);
        if(!embed || !isDirective(lines[line+1] ?? '')) { pending.push(lines[line]); continue; }
        flush();
        const imageLine = line;
        const [target,width] = embed[1].split('|');
        if(!/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(target)) file.fail('alt/caption은 이미지에만 사용할 수 있습니다.',node.position,'mory:image-metadata');
        if(width !== undefined && !/^[1-9]\d*$/.test(width)) file.fail('이미지 너비는 양의 정수여야 합니다.',node.position,'mory:image-metadata');
        const fields:Record<string,string>={};
        while(isDirective(lines[line+1] ?? '')) {
          const d=directive(lines[++line]);
          if(!d) file.fail('이미지 설명은 ::alt[설명], ::caption[설명] 형식으로 작성하세요.',node.position,'mory:image-metadata');
          if(Object.hasOwn(fields,d!.kind)) file.fail(`이미지 ${d!.kind} 설명을 두 번 작성했습니다. 하나만 남기세요.`,node.position,'mory:image-metadata');
          fields[d!.kind]=d!.value;
        }
        const caption = fields.caption !== undefined ? parseInline(fields.caption) : undefined;
        const position=node.position ? structuredClone(node.position) : undefined;
        if(position) { position.start.line=node.position!.start.line+imageLine; position.end.line=node.position!.start.line+line; }
        const img = {type:'html',position,value:imageHtml(target,width,fields.alt ?? (caption ? plain(caption) : ''))};
        replacement.push(caption ? {type:'paragraph',position,data:{hName:'figure',hProperties:{className:['image-figure']}},children:[img,{type:'emphasis',data:{hName:'figcaption'},children:caption}]} : {type:'paragraph',position,children:[img]});
      }
      flush();parent.children.splice(index,1,...replacement);return index+replacement.length;
    });
    visit(tree, 'paragraph', (node, index, parent) => {
      const raw = (node.data as {moryRaw?:string})?.moryRaw ?? (node.position ? source.slice(node.position.start.offset, node.position.end.offset).trim() : '');
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
            try { if (['mp4','webm'].includes(extension!)) { options.onEmbed?.(target); url = (options.assetResolver ?? resolveAssetUrl)(target, owner); } }
            catch (error) { file.fail(error instanceof Error ? error.message : String(error), text.position, 'mory:asset'); }
            const width = label ? ` width="${label}"` : '';
            const name = target.split('/').pop()!;
            result.push({ type: 'html', value: ['mp4', 'webm'].includes(extension!)
              ? `<video controls preload="metadata"${width} aria-label="${escapeHtml(name)}"><source src="${escapeHtml(url!)}" type="video/${extension}"><a href="${escapeHtml(url!)}">${escapeHtml(name)} 다운로드</a></video>`
              : imageHtml(target,label) });
          } else {
            const post = (options.wikilinkContent??content).posts.find(p => p.data.slug === target || p.data.aliases.includes(target));
            if (!post) {
              file.message(`존재하지 않는 wikilink slug: ${target}; 텍스트로 표시합니다.`, text.position, 'mory:wikilink');
              options.onBrokenWikilink?.({ target, label: label || target, line: (text.position?.start.line ?? 1) + text.value.slice(0, match.index).split('\n').length - 1 });
              result.push({ type: 'text', value: label || target });
            } else if (post.data.status !== 'published') {
              file.message(`비공개 글을 참조하는 wikilink: ${target}; 공개 링크를 생성하지 않습니다.`, text.position, 'mory:wikilink');
              options.onBrokenWikilink?.({ target, label:label||target, line:text.position?.start.line??1 });
              result.push({ type: 'text', value: label || target });
            } else result.push({ type: 'link', url: `/writing/${post.data.slug}/`, children: [{ type: 'text', value: label || target }] });
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
