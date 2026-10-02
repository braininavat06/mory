import { z } from 'zod';
export const routeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '소문자 영문/숫자와 하이픈을 사용하세요.');
export function validationMessage(error: unknown): string {
  if (!(error instanceof z.ZodError)) return error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = { slug: '글 주소 (slug)', aliases: '이전 주소', title: '제목', category: '분류', publishedAt: '최초 게시 시각', updatedAt: '수정 시각' };
  return error.issues.map(issue => {
    const field = String(issue.path[0] ?? '콘텐츠');
    const label = labels[field] ?? field;
    const message = issue.code === 'too_small' && field === 'title' ? '제목을 입력해 주세요.' : issue.message;
    return `${label}${issue.path.length > 1 ? ` (${issue.path.slice(1).join('.')})` : ''}: ${message}`;
  }).join('\n');
}
export const ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, '유효한 ULID가 필요합니다.');
const optionalDate = z.preprocess(value => value === '' || value === null ? undefined : value,
  z.union([z.iso.date(), z.iso.datetime({ offset: true }).refine(v => /[+-]\d{2}:\d{2}$/.test(v), 'timezone offset이 필요합니다.')]).optional());
export const postSchema = z.object({
  id: ulid,
  title: z.string().trim().min(1),
  slug: routeId,
  category: routeId,
  publishedAt: optionalDate,
  updatedAt: optionalDate,
  status: z.enum(['draft', 'published', 'archived']),
  description: z.string().trim(),
  aliases: z.array(routeId),
}).strict().superRefine((post, ctx) => {
  if (post.status === 'published' && !post.publishedAt)
    ctx.addIssue({ code: 'custom', path: ['publishedAt'], message: 'published 글에는 최초 공개 날짜가 필요합니다.' });
});
export const pageSchema = z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1) }).strict();
export const categoriesSchema = z.record(routeId, z.object({ name: z.string().trim().min(1), order: z.number() }).strict());
export const seriesEntrySchema = z.object({ id: routeId, name: z.string().trim().min(1), description: z.string().default(''), posts: z.array(ulid).refine(ids => new Set(ids).size === ids.length, '시리즈 안에 중복 글이 있습니다.') }).strict();
export const seriesSchema = z.record(routeId, seriesEntrySchema.omit({ id: true }));
export type PostData = z.infer<typeof postSchema>;
export type PageData = z.infer<typeof pageSchema>;
export type Categories = z.infer<typeof categoriesSchema>;
export type Series = z.infer<typeof seriesSchema>;
