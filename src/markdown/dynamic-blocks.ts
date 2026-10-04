import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { readContent } from '../lib/content.ts';
import type { Content } from '../lib/content.ts';
import { dynamicKinds } from './syntax.ts';
import { renderDynamic } from '../lib/html.ts';
import type { DynamicKind } from '../lib/html.ts';

const dynamicPattern = new RegExp(`^::(${dynamicKinds.join('|')})(.*)$`);
// A separate paragraph-only extension; code, links, and surrounding Markdown are untouched.
export function remarkDynamicBlocks(options: { content?: Content } = {}) {
  return (tree: Root, file: VFile) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (node.children.length !== 1 || node.children[0].type !== 'text') return;
      const raw = node.children[0].value.trim();
      const match = dynamicPattern.exec(raw);
      if (!match || !parent || typeof index !== 'number') return;
      const kind = match[1] as DynamicKind;
      const suffix = match[2];
      let count = 5;
      let seriesId: string | undefined;
      const content = options.content ?? readContent();
      if (kind === 'series-writing') {
        const idMatch = /^\{id=([a-z0-9]+(?:-[a-z0-9]+)*)\}$/.exec(suffix);
        if (!idMatch) file.fail(`시리즈 목록은 ::series-writing{id=시리즈-ID} 형식으로 작성하세요: ${raw}`, node.position, 'mory:dynamic-block');
        seriesId = idMatch![1];
        if (!Object.hasOwn(content.series, seriesId)) file.fail(`존재하지 않는 시리즈 ID: ${seriesId}`, node.position, 'mory:dynamic-block');
      } else if (suffix) {
        const countMatch = kind === 'recent-writing' ? /^\{count=([1-9]\d*)\}$/.exec(suffix) : null;
        if (!countMatch || !Number.isSafeInteger(Number(countMatch[1]))) file.fail(`지원하지 않는 dynamic block 옵션: ${raw}`, node.position, 'mory:dynamic-block');
        count = Number(countMatch![1]);
      }
      const path = (file.path ?? '').replace(/\\/g, '/');
      if (path.includes('/content/posts/') && kind !== 'series-writing') file.fail('이 Dynamic block은 일반 Pages에서만 사용합니다. 글에서는 series-writing만 사용할 수 있습니다.', node.position, 'mory:dynamic-block');
      parent.children[index] = { type: 'html', value: `<div class="dynamic-block">${renderDynamic(kind, content, count, seriesId)}</div>` };
    });
  };
}
