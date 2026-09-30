import { glob } from 'astro/loaders';
import type { Loader } from 'astro/loaders';
import { frontmatter } from './content.ts';

export function markdownLoader(base: string): Loader {
  const loader = glob({ pattern: '**/*.md', base });
  return {
    ...loader,
    load: context => loader.load({
      ...context,
      // Astro's default YAML parser turns unquoted dates into Date objects.
      // Validate the original YAML 1.2 data instead, exactly as the CLI does.
      parseData: entry => {
        if (!entry.filePath) throw new Error(`${base}: Markdown filePath가 없습니다.`);
        return context.parseData({ ...entry, data: frontmatter(entry.filePath).data });
      },
    }),
  };
}
