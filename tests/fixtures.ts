import type { Content } from '../src/lib/content.ts';
import { postSchema } from '../src/lib/schema.ts';
const post = (n: number, slug: string, status: 'published' | 'draft' | 'archived') => ({
  file: `src/content/posts/${slug}.md`, body: '', data: postSchema.parse({
    id: `01K6F4J0M0000000000000000${n}`, title: `샘플 ${n}`, slug, category: 'sample',
    publishedAt: status === 'draft' ? null : n === 4 ? '2026-09-28' : `2026-09-${28+n}`,
    updatedAt: n === 1 ? '2026-10-01' : null, status, description: `설명 ${n}`, aliases: n === 1 ? ['first-note'] : [],
  }),
});
export function fixtureContent(): Content {
  const content: Content = {
    posts: [post(1,'a-place-to-write','published'), post(2,'markdown-notes','published'), post(3,'draft-example','draft'), post(4,'archived-example','archived')],
    pages: ['home','about'].map(key => ({file:`src/content/pages/${key}.md`,key,data:{title:key,description:key},body:`# ${key}`})),
    categories: {sample:{name:'샘플',order:10}},
    series: {'sample-series':{name:'샘플 시리즈',description:'',posts:['01K6F4J0M00000000000000001','01K6F4J0M00000000000000002']}},
  };
  content.posts[0].body = `## Markdown 검증\n\n**굵게** *기울임* ~~취소선~~ ==다시 읽을 이유==[^test]\n\n> [!note]\n> 참고 문장\n\n[[markdown-notes|다음 글]]\n\n| 항목 | 값 |\n| --- | --- |\n| test | value |\n\n- [x] 완료\n- [ ] 미완료\n\n\`\`\`typescript\nconst message = 'Mory';\n\`\`\`\n\n$E=mc^2$\n\n$$\nx^2\n$$\n\n![[image.webp|600]]\n\n![[demo.mp4]]\n\n[^test]: 각주\n`;
  return content;
}
