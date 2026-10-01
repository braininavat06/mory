import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate } from '../client/scroll-sync.ts';

test('scroll correspondence follows source blocks despite unequal rendered heights', () => {
  const anchors = [{ line: 1, top: 0 }, { line: 10, top: 300 }, { line: 12, top: 1500 }, { line: 50, top: 2400 }];
  // A two-line image occupies 1200px; it must not shift all later paragraphs.
  assert.equal(interpolate(anchors, 11, 'line', 'top'), 900);
  assert.equal(interpolate(anchors, 1500, 'top', 'line'), 12);
  for (const line of [1, 4, 10, 11, 12, 30, 50]) {
    const top = interpolate(anchors, line, 'line', 'top');
    assert.ok(Math.abs(interpolate(anchors, top, 'top', 'line') - line) < 1e-9);
  }
});
test('scroll correspondence safely clamps document boundaries and handles an empty preview', () => {
  const anchors = [{ line: 1, top: 0 }, { line: 20, top: 1500 }];
  assert.equal(interpolate(anchors, -10, 'line', 'top'), 0);
  assert.equal(interpolate(anchors, 100, 'line', 'top'), 1500);
  assert.equal(interpolate(anchors, 3000, 'top', 'line'), 20);
  assert.equal(interpolate([], 5, 'line', 'top'), 0);
});
