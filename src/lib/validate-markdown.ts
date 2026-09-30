import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownOptions } from '../markdown/pipeline.ts';
import type { Content } from './content.ts';

export async function validateMarkdown(content: Content, root = process.cwd()) {
  const options = createMarkdownOptions(content);
  const renderer = await options.processor.createRenderer(options);
  const errors: string[] = [];
  for (const entry of [...content.posts, ...content.pages]) {
    try {
      await renderer.render(entry.body, { fileURL: pathToFileURL(resolve(root, entry.file)), frontmatter: entry.data });
    } catch (error) { errors.push(`${entry.file}: ${error instanceof Error ? error.message : error}`); }
  }
  // Astro's collection loader can log renderer errors and continue; make them fatal here.
  if (errors.length) throw new Error(`Markdown 검증 실패:\n${errors.map(error => `- ${error}`).join('\n')}`);
}
