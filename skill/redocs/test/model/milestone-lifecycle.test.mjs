import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonPairs, isAlive, milestoneOrder, resolveVariant } from '../../lib/milestone-order-and-lifecycle.mjs';

const milestones = [
  { id: 'v1', status: 'superseded' },
  { id: 'v2', status: 'current' },
  { id: 'v3', status: 'planned' },
  { id: 'target', status: 'target' },
];
const order = milestoneOrder(milestones);

test('isAlive honours since (inclusive) and until (exclusive)', () => {
  const entity = { since: 'v2', until: 'target' };
  assert.deepEqual(milestones.map((m) => isAlive(entity, m.id, order)), [false, true, true, false]);
  assert.deepEqual(milestones.map((m) => isAlive({}, m.id, order)), [true, true, true, true]);
});

test('resolveVariant: shared, exact, inherited and absent', () => {
  assert.deepEqual(resolveVariant({ entry: 'index.md', variants: null }, 'v3', milestones), { file: 'index.md', variant: null, inheritedFrom: null });
  const page = { variants: { v2: 'v2.md', target: 'target.html' } };
  assert.deepEqual(resolveVariant(page, 'v2', milestones), { file: 'v2.md', variant: 'v2', inheritedFrom: null });
  assert.deepEqual(resolveVariant(page, 'v3', milestones), { file: 'v2.md', variant: 'v2', inheritedFrom: 'v2' });
  assert.equal(resolveVariant(page, 'v1', milestones), null);
});

test('comparisonPairs: adjacent pairs plus current -> target', () => {
  assert.deepEqual(comparisonPairs(milestones), [['v1', 'v2'], ['v2', 'v3'], ['v3', 'target'], ['v2', 'target']]);
  assert.deepEqual(comparisonPairs([{ id: 'a', status: 'current' }, { id: 'b', status: 'target' }]), [['a', 'b']]);
});
