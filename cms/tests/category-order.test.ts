import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedCategories, moveCategory } from '../client/categories.ts';
const registry = { second: { name: '두 번째', order: 20 }, first: { name: '첫 번째', order: 10 }, tied: { name: '동순위', order: 20 } };
test('category order follows public order, ties remain deterministic', () => {
  assert.deepEqual(orderedCategories(registry).map(([id]) => id), ['first', 'second', 'tied']);
});
test('moving category preserves permanent IDs and names, handles equal order', () => {
  const next = moveCategory(registry, 'tied', -1);
  assert.deepEqual(orderedCategories(next).map(([id]) => id), ['first', 'tied', 'second']);
  assert.equal(next.tied.name, registry.tied.name);
  assert.deepEqual(registry.second, { name: '두 번째', order: 20 });
  assert.deepEqual(orderedCategories(moveCategory(next, 'tied', 1)).map(([id]) => id), ['first', 'second', 'tied']);
});
test('invalid and boundary moves do not change registry', () => {
  assert.equal(moveCategory(registry, 'first', -1), registry);
  assert.equal(moveCategory(registry, 'tied', 1), registry);
  assert.equal(moveCategory(registry, 'missing', 1), registry);
  assert.deepEqual(moveCategory({}, 'missing', 1), {});
});
