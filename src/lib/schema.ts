import { z } from 'zod';
export const routeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '소문자 영문/숫자와 하이픈을 사용하세요.');
export const ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, '유효한 ULID가 필요합니다.');
const optionalDate = z.preprocess(value => value === '' || value === null ? undefined : value,
  z.iso.date({ error: 'YYYY-MM-DD calendar date만 사용하세요.' }).optional());
export const postSchema = z.object({
  id: ulid,
  title: z.string().trim().min(1),
  slug: routeId,
  category: routeId,
  publishedAt: optionalDate,
  updatedAt: optionalDate,
  status: z.enum(['draft', 'published', 'archived']),
  description: z.string().trim().min(1),
  aliases: z.array(routeId),
}).strict().superRefine((post, ctx) => {
  if (post.status === 'published' && !post.publishedAt)
    ctx.addIssue({ code: 'custom', path: ['publishedAt'], message: 'published 글에는 최초 공개 날짜가 필요합니다.' });
});
export const pageSchema = z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1) }).strict();
export const categoriesSchema = z.record(routeId, z.object({ name: z.string().trim().min(1), order: z.number() }).strict());
export const seriesSchema = z.record(routeId, z.object({ name: z.string().trim().min(1), posts: z.array(ulid) }).strict());
export type PostData = z.infer<typeof postSchema>;
export type PageData = z.infer<typeof pageSchema>;
export type Categories = z.infer<typeof categoriesSchema>;
export type Series = z.infer<typeof seriesSchema>;
