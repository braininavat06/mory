import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownOptions } from '../markdown/pipeline.ts';
import type { Content } from './content.ts';

export interface MarkdownIssue { file: string; title: string; message: string }
export class MarkdownValidationError extends Error {
  issues: MarkdownIssue[];
  constructor(issues: MarkdownIssue[]) {
    super(`Markdown 검증 실패:\n${issues.map(issue => `- ${issue.file}: ${issue.message}`).join('\n')}`);
    this.issues = issues;
  }
}

export async function validateMarkdown(content: Content, root = process.cwd()) {
  let currentFile = '';
  const options = createMarkdownOptions(content, [], link => console.warn(`${currentFile}:${link.line}: 끊어진 wikilink [[${link.target}]]; 텍스트로 표시합니다.`));
  const renderer = await options.processor.createRenderer(options);
  const errors: MarkdownIssue[] = [];
  for (const entry of [...content.posts, ...content.pages]) {
    currentFile = entry.file;
    try {
      await renderer.render(entry.body, { fileURL: pathToFileURL(resolve(root, entry.file)), frontmatter: entry.data });
    } catch (error) { errors.push({ file: entry.file, title: entry.data.title, message: error instanceof Error ? error.message : String(error) }); }
  }
  // Astro's collection loader can log renderer errors and continue; make them fatal here.
  if (errors.length) throw new MarkdownValidationError(errors);
}
