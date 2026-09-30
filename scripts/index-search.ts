import * as pagefind from 'pagefind';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { publishedPosts, readContent } from '../src/lib/content.ts';
function assertNoErrors(result: { errors: string[] }) {
  if (result.errors.length) throw new Error(`Pagefind: ${result.errors.join('\n')}`);
}
try {
  // The Node API can emit a real Pagefind bundle even for an empty archive.
  const created = await pagefind.createIndex({ rootSelector: '[data-pagefind-body]' });
  assertNoErrors(created);
  if (!created.index) throw new Error('Pagefind index를 생성하지 못했습니다.');
  assertNoErrors(await created.index.addDirectory({ path: resolve('dist') }));
  assertNoErrors(await created.index.writeFiles({ outputPath: resolve('dist/pagefind') }));
  const index = JSON.parse(readFileSync('dist/pagefind/pagefind-entry.json', 'utf8')) as { languages: Record<string, { page_count: number }> };
  const count = Object.values(index.languages).reduce((sum, lang) => sum + lang.page_count, 0);
  if (count !== publishedPosts(readContent()).length) throw new Error(`Pagefind 글 수 불일치: indexed ${count}`);
  console.log(`Pagefind 인덱스 생성 완료: 공개 글 ${count}개, dist/pagefind`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await pagefind.close(); }
