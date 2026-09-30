import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkObsidian } from './obsidian.ts';
import { remarkDynamicBlocks } from './dynamic-blocks.ts';
import type { Content } from '../lib/content.ts';
export function createMarkdownOptions(content?: Content) {
  return {
    processor: unified({
      gfm: true,
      smartypants: false,
      remarkPlugins: [remarkMath, [remarkObsidian, { content }], [remarkDynamicBlocks, { content }]],
      rehypePlugins: [rehypeKatex],
      remarkRehype: { footnoteLabel: '각주', footnoteBackLabel: '본문으로 돌아가기' },
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } as const },
  };
}
export const markdownOptions = createMarkdownOptions();
