import { visit } from 'unist-util-visit';
import type { Root } from 'hast';

// Preview-only source markers; rendering still uses the public pipeline.
export function rehypePreviewSource() {
  return (tree: Root) => {
    visit(tree, 'element', node => {
      if (!node.position || !['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'li', 'blockquote', 'aside', 'img', 'video', 'figure'].includes(node.tagName)) return;
      node.properties['data-source-start'] = node.position.start.line;
    });
  };
}
