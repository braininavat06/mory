import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { parse } from 'yaml';
import { postSchema, pageSchema, categoriesSchema, seriesEntrySchema, validationMessage } from './schema.ts';
import type { PostData, PageData, Categories, Series } from './schema.ts';
export interface Post { file: string; data: PostData; body: string }
export interface Page { file: string; key: string; data: PageData; body: string }
export interface Content { posts: Post[]; pages: Page[]; categories: Categories; series: Series }
function markdownFiles(dir: string): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (error) {
    // Git does not retain empty directories after the last post is deleted.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.flatMap(entry =>
    entry.isDirectory() ? markdownFiles(join(dir, entry.name)) : entry.name.endsWith('.md') ? [join(dir, entry.name)] : []).sort();
}
export function frontmatter(file: string) {
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${file}: Markdown frontmatter가 필요합니다.`);
  return { data: parse(match[1]), body: match[2] };
}
export function validateRelations(content: Content): string[] {
  const errors: string[] = [];
  const ids = new Map<string, string>();
  const slugs = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const { file, data } of content.posts) {
    if (ids.has(data.id)) errors.push(`${file}: duplicate post id ${data.id} (${ids.get(data.id)})`);
    ids.set(data.id, file);
    if (slugs.has(data.slug)) errors.push(`${file}: duplicate slug ${data.slug} (${slugs.get(data.slug)})`);
    slugs.set(data.slug, file);
    if (!Object.hasOwn(content.categories, data.category)) errors.push(`${file}: invalid category ${data.category} (src/data/categories.yaml)`);
    for (const alias of data.aliases) {
      if (aliases.has(alias)) errors.push(`${file}: alias 충돌 ${alias} (${aliases.get(alias)})`);
      aliases.set(alias, file);
    }
    for (const route of [data.slug, ...data.aliases]) {
      if (['oldest', 'updated', 'page'].includes(route)) errors.push(`${file}: ${route}는 Writing 목록의 예약 경로입니다.`);
    }
  }
  for (const [alias, file] of aliases) if (slugs.has(alias)) errors.push(`${file}: alias ${alias}와 active slug 충돌 (${slugs.get(alias)})`);
  for (const [seriesId, series] of Object.entries(content.series)) {
    for (const id of series.posts) {
      if (!ids.has(id)) errors.push(`data/series/${seriesId}.yaml: ${seriesId}에 존재하지 않는 post id ${id}`);
    }
  }
  return errors;
}
export function readContent(root = process.cwd()): Content {
  const errors: string[] = [];
  const content: Content = { posts: [], pages: [], categories: {}, series: {} };
  function read<T>(file: string, parser: (input: unknown) => T, markdown = false): { data: T; body: string } | undefined {
    try {
      const raw = markdown ? frontmatter(resolve(root, file)) : { data: parse(readFileSync(resolve(root, file), 'utf8')), body: '' };
      return { data: parser(raw.data), body: raw.body };
    } catch (error) { errors.push(`${file}: ${validationMessage(error)}`); }
  }
  content.categories = read('src/data/categories.yaml', v => categoriesSchema.parse(v))?.data ?? {};
  const seriesDir = resolve(root, 'data/series');
  if (existsSync(seriesDir)) for (const name of readdirSync(seriesDir).filter(n => n.endsWith('.yaml')).sort()) {
    const file = `data/series/${name}`;
    const entry = read(file, v => seriesEntrySchema.parse(v))?.data;
    if (entry) {
      if (name !== `${entry.id}.yaml`) errors.push(`${file}: 파일명과 series id가 다릅니다.`);
      if (content.series[entry.id]) errors.push(`${file}: 중복 series id`);
      const { id, ...data } = entry; content.series[id] = data;
    }
  }
  for (const path of markdownFiles(resolve(root, 'src/content/posts'))) {
    const file = relative(root, path);
    const entry = read(file, v => postSchema.parse(v), true);
    if (entry) content.posts.push({ file, ...entry });
  }
  for (const path of markdownFiles(resolve(root, 'src/content/pages'))) {
    const file = relative(root, path);
    const entry = read(file, v => pageSchema.parse(v), true);
    if (entry) content.pages.push({ file, key: relative(resolve(root, 'src/content/pages'), path).replace(/\.md$/, ''), ...entry });
  }
  for (const key of ['home', 'about']) if (!content.pages.some(p => p.key === key)) errors.push(`src/content/pages/${key}.md: 필수 page가 없습니다.`);
  errors.push(...validateRelations(content));
  if (errors.length) throw new Error(`콘텐츠 검증 실패:\n${errors.map(e => `- ${e}`).join('\n')}`);
  return content;
}
export function publishedPosts(content: Content) { return content.posts.filter(p => p.data.status === 'published'); }
export function orderedCategories(content: Content) {
  return Object.entries(content.categories).sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]));
}
export function publicSeries(content: Content) {
  const published = new Map(publishedPosts(content).map(p => [p.data.id, p]));
  return Object.entries(content.series).map(([id, series]) => ({ id, name: series.name, description: series.description,
    posts: series.posts.flatMap(postId => published.has(postId) ? [published.get(postId)!] : []) })).filter(s => s.posts.length);
}
