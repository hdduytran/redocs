// `redocs promote <book> <milestone>`: the system reached a new milestone. Moves the
// "current" pointer (earlier milestones become superseded) and lists what to review.
// It never rewrites page content: what changed in reality is the owner's call.

import path from 'node:path';
import { diffMilestones } from './build-generated-pages.mjs';
import { loadBook } from './load-book-from-directory.mjs';
import { currentMilestone } from './milestone-order-and-lifecycle.mjs';
import { RedocsError, writeJsonFile } from './shared-helpers.mjs';

export function promoteMilestone({ book: bookDir, milestone }) {
  const book = loadBook(bookDir);
  const index = book.milestones.findIndex((m) => m.id === milestone);
  if (index < 0) throw new RedocsError(`Unknown milestone '${milestone}'`, { code: 'ERR_REDOCS_ARGS' });
  const previous = currentMilestone(book.milestones);
  if (previous.id === milestone) throw new RedocsError(`'${milestone}' is already current`, { code: 'ERR_REDOCS_ARGS' });
  if (index < book.milestones.indexOf(previous)) {
    throw new RedocsError(`'${milestone}' comes before the current milestone '${previous.id}'`, { code: 'ERR_REDOCS_ARGS', hint: 'Milestones only move forward; reorder book.json if the plan changed.' });
  }

  const config = { ...book.config };
  config.milestones = book.milestones.map((m, i) => {
    if (i < index) return { ...m, status: 'superseded' };
    if (i === index) return { ...m, status: 'current' };
    return m;
  });
  writeJsonFile(path.join(book.root, 'book.json'), config);

  const diff = diffMilestones(book, previous.id, milestone);
  const review = [
    ...diff.changedPages.map((id) => `page ${id}: confirm the ${milestone} variant now describes reality`),
    ...diff.added.map((e) => `entity ${e.id}: confirm it is live`),
    ...diff.removed.map((e) => `entity ${e.id}: confirm it is gone`),
    ...diff.replaced.map((e) => `entity ${e.id}: confirm ${e.replaced_by} replaced it`),
  ];
  return {
    ok: true,
    command: 'promote',
    summary: `OK promote: ${previous.id} -> ${milestone} is now current.${review.length ? `\n  Review with the owner:\n${review.map((r) => `   - ${r}`).join('\n')}` : ''}`,
    previous: previous.id,
    current: milestone,
    review,
    modified: ['book.json'],
  };
}
