// Milestone ordering, entity lifecycle and page-variant resolution.
//
// Milestones are architecture states (v1, v2, target), ordered as declared in book.json.
// An entity is alive at milestone m when since <= m < until.

/** @returns {Map<string, number>} milestone id -> position */
export function milestoneOrder(milestones) {
  return new Map(milestones.map((m, index) => [m.id, index]));
}

export function currentMilestone(milestones) {
  return milestones.find((m) => m.status === 'current') || milestones[0];
}

/** Entity lifecycle check. Unknown milestone ids are treated as "always" so check can report them separately. */
export function isAlive(entity, milestoneId, order) {
  const at = order.get(milestoneId);
  if (at === undefined) return true;
  const since = entity.since !== undefined ? order.get(entity.since) : 0;
  const until = entity.until !== undefined ? order.get(entity.until) : Infinity;
  return (since ?? 0) <= at && at < (until ?? Infinity);
}

/**
 * Pick the source file a page renders at a milestone.
 * - No variants: the shared entry file.
 * - Exact variant: that file.
 * - Otherwise the nearest earlier variant (inherited), or null when the page has no
 *   variant at or before this milestone (the page does not exist yet at m).
 * @returns {{file: string, variant: string|null, inheritedFrom: string|null} | null}
 */
export function resolveVariant(page, milestoneId, milestones) {
  if (!page.variants) return { file: page.entry, variant: null, inheritedFrom: null };
  if (page.variants[milestoneId]) return { file: page.variants[milestoneId], variant: milestoneId, inheritedFrom: null };
  const index = milestones.findIndex((m) => m.id === milestoneId);
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = milestones[i].id;
    if (page.variants[earlier]) return { file: page.variants[earlier], variant: earlier, inheritedFrom: earlier };
  }
  return null;
}

/** Ordered pairs worth comparing: each adjacent pair plus current -> last (target) when not adjacent. */
export function comparisonPairs(milestones) {
  const pairs = [];
  for (let i = 0; i + 1 < milestones.length; i += 1) pairs.push([milestones[i].id, milestones[i + 1].id]);
  const current = milestones.findIndex((m) => m.status === 'current');
  const last = milestones.length - 1;
  if (current >= 0 && last - current > 1) pairs.push([milestones[current].id, milestones[last].id]);
  return pairs;
}
