import { routeId, ulid } from '../src/lib/schema.ts';

// Generate once for an empty, unpublished address; titles never own an existing slug.
export function generatePostSlug(title: string, id: string): string {
  const candidate = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const fallback = `post-${ulid.parse(id).slice(-16).toLowerCase()}`;
  return routeId.parse(candidate && !['oldest', 'updated', 'page'].includes(candidate) ? candidate : fallback);
}
