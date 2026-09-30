import { readContent } from '../src/lib/content.ts';
import { validateMarkdown } from '../src/lib/validate-markdown.ts';
try {
  const content = readContent();
  await validateMarkdown(content);
  console.log(`콘텐츠 검증 완료: Posts ${content.posts.length}, Pages ${content.pages.length}, Categories ${Object.keys(content.categories).length}, Series ${Object.keys(content.series).length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
