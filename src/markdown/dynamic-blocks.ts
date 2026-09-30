import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { readContent } from '../lib/content.ts';
import type { Content } from '../lib/content.ts';
import { renderDynamic } from '../lib/html.ts';
import type { DynamicKind } from '../lib/html.ts';

// A separate paragraph-only extension; code, links, and surrounding Markdown are untouched.
export function remarkDynamicBlocks(options: { content?: Content } = {}) {
  return (tree: Root, file: VFile) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (node.children.length !== 1 || node.children[0].type !== 'text') return;
      const raw = node.children[0].value.trim();
      const match = /^::(recent-writing|category-list|series-list|writing-search|writing-list)(.*)$/.exec(raw);
      if (!match || !parent || typeof index !== 'number') return;
      const kind = match[1] as DynamicKind;
      const suffix = match[2];
      let count = 5;
      if (suffix) {
        const countMatch = kind === 'recent-writing' ? /^\{count=([1-9]\d*)\}$/.exec(suffix) : null;
        if (!countMatch || !Number.isSafeInteger(Number(countMatch[1]))) file.fail(`지원하지 않는 dynamic block 옵션: ${raw}`, node.position, 'mory:dynamic-block');
        count = Number(countMatch![1]);
      }
      const path = (file.path ?? '').replace(/\\/g, '/');
      if (path.includes('/content/posts/')) file.fail('Dynamic blocks는 일반 Pages에서만 사용합니다.', node.position, 'mory:dynamic-block');
      parent.children[index] = { type: 'html', value: `<div class="dynamic-block">${renderDynamic(kind, options.content ?? readContent(), count)}</div>` };
    });
  };
}
