import { visit } from 'unist-util-visit';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { AssetOwner } from '../lib/assets.ts';
import type { BrokenWikilink } from './obsidian.ts';
import { remarkObsidian } from './obsidian.ts';
import { remarkDynamicBlocks } from './dynamic-blocks.ts';
import type { Content } from '../lib/content.ts';
import type { RehypePlugins } from '@astrojs/markdown-remark';
function rehypeImages() { return (tree:any) => { visit(tree,'element',(node:any)=>{ if(node.tagName==='img') node.properties={...node.properties,loading:'lazy',decoding:'async'}; }); }; }
export function createMarkdownOptions(content?: Content, extraRehypePlugins: RehypePlugins = [], onBrokenWikilink?: (link: BrokenWikilink) => void, assets: { onEmbed?: (filename: string) => void; onAssetUrl?: (url: string) => void; onAssetHtml?: (html: string) => void; assetResolver?: (filename: string, owner?: AssetOwner) => string } = {}) {
  return {
    processor: unified({
      gfm: true,
      smartypants: false,
      remarkPlugins: [remarkMath, [remarkObsidian, { content, onBrokenWikilink, ...assets }], [remarkDynamicBlocks, { content }]],
      rehypePlugins: [rehypeKatex, rehypeImages, ...extraRehypePlugins],
      remarkRehype: { footnoteLabel: '각주', footnoteBackLabel: '본문으로 돌아가기' },
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } as const },
  };
}
export const markdownOptions = createMarkdownOptions();
