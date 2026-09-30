import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { markdownOptions } from './src/markdown/pipeline.ts';
import { readContent } from './src/lib/content.ts';
import { SITE } from './src/lib/config.ts';
if (existsSync('.env')) process.loadEnvFile('.env');
const content = readContent();
const aliases = new Set(content.posts.flatMap(p => p.data.aliases.map(a => `${SITE}/writing/${a}/`)));
export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: url => !aliases.has(url) })],
  markdown: markdownOptions,
});
