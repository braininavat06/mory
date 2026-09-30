import { defineCollection } from 'astro:content';
import { markdownLoader } from './lib/markdown-loader.ts';
import { postSchema, pageSchema } from './lib/schema.ts';
export const collections = {
  posts: defineCollection({ loader: markdownLoader('./src/content/posts'), schema: postSchema }),
  pages: defineCollection({ loader: markdownLoader('./src/content/pages'), schema: pageSchema }),
};
