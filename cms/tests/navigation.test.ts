import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CmsNavigation, locationHash, readLocation } from '../client/navigation.ts';

function fixture(hash = '#/writing') {
  const entries = [{ state: {} as any, hash }]; let cursor = 0;
  let pending: (() => void) | undefined, reject = false;
  const shown: string[] = [];
  const history = {
    get state() { return entries[cursor].state; },
    replaceState(state: any, _: string, hash: string) { entries[cursor] = { state, hash }; },
    pushState(state: any, _: string, hash: string) { entries.splice(++cursor, Infinity, { state, hash }); },
    go(delta: number) { cursor += delta; events.push(() => controller.pop(entries[cursor].hash, entries[cursor].state)); },
  };
  const events: (() => void)[] = [];
  const controller = new CmsNavigation(history, hash, action => { pending = reject ? undefined : action; }, location => shown.push(locationHash(location)));
  const flush = () => { const action = pending; pending = undefined; action?.(); };
  const eventsFlush = () => { while (events.length) events.shift()!(); };
  return { controller, entries, history, shown, flush, eventsFlush, reject: () => { reject = true; }, current: () => entries[cursor], back: () => { history.go(-1); eventsFlush(); }, forward: () => { history.go(1); eventsFlush(); } };
}
test('CMS URLs round-trip stable document identity and menu; invalid menu safely falls back', () => {
  for (const menu of ['Writing', 'Categories', 'Series', 'Pages', 'Issues', 'Tips'] as const) assert.deepEqual(readLocation(locationHash({ menu })), { menu });
  const route = { menu: 'Issues' as const, draft: 'post:01KABC' };
  assert.deepEqual(readLocation(locationHash(route)), route);
  assert.deepEqual(readLocation('#/unknown'), { menu: 'Writing' });
  assert.deepEqual(readLocation('#/tips?draft=post%3Afoo'), { menu: 'Tips' });
});
test('navigation waits for autosave acknowledgement before changing screen or URL', () => {
  const f = fixture(); f.controller.navigate({ menu: 'Pages', draft: 'page:home' });
  assert.equal(f.current().hash, '#/writing'); assert.equal(f.shown.length, 0);
  f.flush(); assert.equal(f.current().hash, '#/pages?draft=page%3Ahome');
  const reloaded = fixture(f.current().hash); assert.deepEqual(readLocation(reloaded.current().hash), { menu: 'Pages', draft: 'page:home' });
});
test('back and forward restore current URL while saving then apply exact historical destination', () => {
  const f = fixture();
  f.controller.navigate({ menu: 'Issues' }); f.flush();
  f.controller.navigate({ menu: 'Issues', draft: 'page:home' }); f.flush();
  f.back(); assert.equal(f.current().hash, '#/issues?draft=page%3Ahome');
  f.flush(); f.eventsFlush(); assert.equal(f.current().hash, '#/issues');
  f.forward(); assert.equal(f.current().hash, '#/issues');
  f.flush(); f.eventsFlush(); assert.equal(f.current().hash, '#/issues?draft=page%3Ahome');
});
test('conflict cancellation or failed save retains editor URL and history without losing recovery', () => {
  const f = fixture(); f.controller.navigate({ menu: 'Writing', draft: 'post:one' }); f.flush();
  f.reject(); f.back(); f.flush(); f.eventsFlush();
  assert.equal(f.current().hash, '#/writing?draft=post%3Aone');
  assert.equal(f.shown.at(-1), '#/writing?draft=post%3Aone');
  assert.equal(f.entries[0].hash, '#/writing');
});
test('reloading preserves history index, and replacing an invalid/deleted document adds no history entry', () => {
  const f = fixture('#/pages?draft=page%3Amissing');
  f.controller.navigate({ menu: 'Pages' }, true); f.flush();
  assert.equal(f.entries.length, 1); assert.equal(f.current().hash, '#/pages');
  f.controller.navigate({ menu: 'Pages' }); f.flush(); assert.equal(f.entries.length, 1);
});

test('a slower earlier navigation cannot replace a newer destination', () => {
  const actions: (() => void)[] = [], shown: string[] = [];
  const history = { state: {}, replaceState() {}, pushState() {}, go() {} };
  const controller = new CmsNavigation(history, '#/writing', action => actions.push(action), route => shown.push(locationHash(route)));
  controller.navigate({ menu: 'Pages' }); controller.navigate({ menu: 'Tips' });
  actions[1](); actions[0](); assert.deepEqual(shown, ['#/tips']);
});

test('Analytics tabs round-trip in the URL and invalid tabs fall back to overview', () => {
  for (const analyticsTab of ['visitors', 'pages', 'search'] as const) {
    const location = { menu: 'Analytics' as const, analyticsTab };
    assert.deepEqual(readLocation(locationHash(location)), location);
  }
  assert.equal(locationHash({ menu: 'Analytics', analyticsTab: 'overview' }), '#/analytics');
  assert.deepEqual(readLocation('#/analytics?tab=invalid'), { menu: 'Analytics' });
  assert.deepEqual(readLocation('#/writing?tab=search'), { menu: 'Writing' });
});
test('Analytics tab history supports back, forward, reload and duplicate-click no-op', () => {
  const f = fixture('#/analytics');
  f.controller.navigate({ menu: 'Analytics', analyticsTab: 'visitors' }); f.flush();
  f.controller.navigate({ menu: 'Analytics', analyticsTab: 'pages' }); f.flush();
  f.controller.navigate({ menu: 'Analytics', analyticsTab: 'pages' }); f.flush();
  assert.equal(f.entries.length, 3);
  f.back(); f.flush(); f.eventsFlush();
  assert.equal(f.current().hash, '#/analytics?tab=visitors');
  assert.deepEqual(readLocation(fixture(f.current().hash).current().hash), { menu: 'Analytics', analyticsTab: 'visitors' });
  f.forward(); f.flush(); f.eventsFlush();
  assert.equal(f.current().hash, '#/analytics?tab=pages');
  f.back(); f.flush(); f.eventsFlush();
  f.back(); f.flush(); f.eventsFlush();
  assert.equal(f.current().hash, '#/analytics');
});
