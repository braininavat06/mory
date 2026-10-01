import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CmsError } from '../shared.ts';
import type { Store } from './store.ts';
import type { Publisher } from './publish.ts';
import { renderPreview } from './preview.ts';
const keySchema = z.string().regex(/^(post:[0-7][0-9A-HJKMNP-TV-Z]{25}|page:(home|about)|categories:registry|series:[a-z0-9]+(?:-[a-z0-9]+)*)$/);
export function createApp(store: Store, publisher: Publisher, origin: string) {
  const app = new Hono();
  const previews = new Map<string, { html: string; at: number }>();
  app.use('*', async (c, next) => {
    if (c.req.header('host') !== new URL(origin).host) return c.json({ error: '허용되지 않은 호스트입니다.' }, 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('origin') !== origin || !c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: '동일한 CMS 화면에서 요청하세요.' }, 403);
    }
    const immutableAsset = /^\/(assets|preview-assets\/assets)\//.test(c.req.path) && /-[A-Za-z0-9_-]{8}\.(js|css|woff2?|ttf)$/.test(c.req.path);
    c.header('Cache-Control', immutableAsset ? 'public, max-age=31536000, immutable' : 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' https: data:; media-src 'self' https:; frame-src 'self' https://www.youtube-nocookie.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'");
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 3_000_000 }));
  app.onError((error, c) => {
    if (error instanceof CmsError) return c.json({ error: error.message }, error.status as 400);
    if (error instanceof z.ZodError) return c.json({ error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('\n') }, 400);
    console.error('CMS request failed:', error.message); return c.json({ error: '서버 요청을 처리하지 못했습니다. 입력 내용은 이 창에 보존되어 있습니다.' }, 500);
  });
  app.get('/api/health', c => c.json({ service: 'mory-cms', ok: true }));
  app.get('/api/state', async c => {
    await Promise.all(store.jobs().filter(j => j.state === 'deploying' || (j.state === 'failed' && j.pushed_at)).map(j => publisher.deployment(j.id)));
    return c.json({ drafts: store.list(), jobs: store.jobs().map(({ snapshot: _, ...job }) => job), localSync: store.localSync(), canRetryDeployment: !!publisher.options.retryDeployment });
  });
  app.post('/api/local-sync/retry', async c => { await c.req.json(); return c.json(await publisher.retryLocalSync()); });
  app.get('/api/drafts/:key', c => c.json(store.get(keySchema.parse(c.req.param('key')))));
  app.post('/api/drafts', async c => {
    const data = z.object({ kind: z.enum(['post', 'series']), id: z.string().optional() }).parse(await c.req.json());
    return c.json(store.create(data.kind, data.id), 201);
  });
  app.put('/api/drafts/:key', async c => {
    const key = keySchema.parse(c.req.param('key'));
    const input = z.object({ revision: z.number().int().positive(), value: z.object({ body: z.string(), data: z.record(z.string(), z.any()), deleted: z.boolean().optional() }), slugChange: z.boolean().optional() }).parse(await c.req.json());
    return c.json(store.save(key, input.revision, input.value, input.slugChange));
  });
  app.post('/api/publish/:key', async c => {
    const key = keySchema.parse(c.req.param('key'));
    const input = z.object({ revision: z.number().int().positive(), action: z.enum(['publish', 'archive', 'restore', 'delete']).default('publish') }).parse(await c.req.json());
    const { snapshot: _, ...job } = publisher.request(key, input.revision, input.action); return c.json(job, 202);
  });
  app.post('/api/reload-public/:key', async c => {
    const input = z.object({ revision: z.number().int().positive() }).parse(await c.req.json());
    return c.json(await publisher.reloadPublic(keySchema.parse(c.req.param('key')), input.revision));
  });
  app.get('/api/jobs/:id', async c => { const { snapshot: _, ...job } = await publisher.deployment(c.req.param('id')); return c.json(job); });
  app.post('/api/jobs/:id/retry', async c => { const { snapshot: _, ...job } = await publisher.retryDeployment(c.req.param('id')); return c.json(job); });
  app.post('/api/preview/:key', async c => {
    const input = z.object({ value: z.object({ body: z.string(), data: z.record(z.string(), z.any()) }), theme: z.enum(['light', 'dark']).default('light') }).parse(await c.req.json());
    const html = await renderPreview(store, keySchema.parse(c.req.param('key')), input.value, input.theme);
    for (const [id, preview] of previews) if (Date.now() - preview.at > 600_000) previews.delete(id);
    while (previews.size >= 32) previews.delete(previews.keys().next().value!);
    const id = randomUUID(); previews.set(id, { html, at: Date.now() });
    return c.json({ url: `/api/preview-view/${id}` });
  });
  app.get('/api/preview-view/:id', c => {
    const preview = previews.get(c.req.param('id'));
    return preview ? c.html(preview.html) : c.text('미리보기를 다시 열어주세요.', 404);
  });
  app.use('/preview-assets/*', serveStatic({ root: join(store.root, 'cms/dist/preview'), rewriteRequestPath: p => p.replace('/preview-assets', '') }));
  app.use('/fixtures/*', serveStatic({ root: join(store.root, 'public') }));
  app.use('/pagefind/*', serveStatic({ root: join(store.root, 'dist') }));
  app.use('/assets/*', serveStatic({ root: join(store.root, 'cms/dist') }));
  app.get('*', c => {
    const path = join(store.root, 'cms/dist/index.html');
    return existsSync(path) ? c.html(readFileSync(path, 'utf8')) : c.text('먼저 npm run cms:build를 실행하세요.', 503);
  });
  return app;
}
