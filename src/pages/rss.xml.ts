import type { APIRoute } from 'astro';
import { SITE, SITE_DESCRIPTION } from '../lib/config.ts';
import { publishedPosts, readContent } from '../lib/content.ts';
import { sortPosts } from '../lib/listing.ts';
import { escapeHtml } from '../lib/html.ts';
import { rssDate } from '../lib/dates.ts';
export const GET: APIRoute = () => {
  const posts = sortPosts(publishedPosts(readContent()), 'latest');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Mory Writing</title><link>${SITE}/writing/</link><description>${escapeHtml(SITE_DESCRIPTION)}</description><language>ko</language><atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>${posts.map(({ data: p }) => `<item><title>${escapeHtml(p.title)}</title><description>${escapeHtml(p.description)}</description><pubDate>${rssDate(p.publishedAt!)}</pubDate><link>${SITE}/writing/${p.slug}/</link><guid isPermaLink="true">${SITE}/writing/${p.slug}/</guid></item>`).join('')}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
