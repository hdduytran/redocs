// `redocs comment <book> <page-id>`: append a review comment to comments/<page-id>.jsonl.
// Comments are a Git-tracked review record — "multiple people" means many authors committing
// (or opening PRs); agents use the same command. No server, no network: the build renders the
// file into a static thread under the page. Supports threaded replies and resolve/reopen.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBook } from './load-book-from-directory.mjs';
import { ID_PATTERNS, RedocsError, resolveInside } from './shared-helpers.mjs';

function commentsFile(root, pageId) {
  return resolveInside(path.join(root, 'comments'), `${pageId}.jsonl`);
}

function readComments(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function nextCommentId(existing) {
  // Deterministic within a file: c-1, c-2, ... so ids are stable and diffs stay small.
  let n = existing.length + 1;
  const ids = new Set(existing.map((c) => c.id));
  while (ids.has(`c-${n}`)) n += 1;
  return `c-${n}`;
}

/**
 * Add a comment (or reply) to a page's thread.
 * @param {{book: string, page: string, author: string, body: string, anchor?: string,
 *          replyTo?: string, created?: string}} o
 */
export function addComment(o) {
  if (!ID_PATTERNS.pageId.test(o.page || '')) throw new RedocsError(`Invalid page id '${o.page}'`, { code: 'ERR_REDOCS_ARGS' });
  if (!o.author) throw new RedocsError('--author is required', { code: 'ERR_REDOCS_ARGS' });
  if (!o.body) throw new RedocsError('--body is required', { code: 'ERR_REDOCS_ARGS' });
  const book = loadBook(o.book);
  if (!book.pages.has(o.page)) throw new RedocsError(`Unknown page '${o.page}'`, { code: 'ERR_REDOCS_ARGS', hint: 'Run `redocs check <book>` to list pages.' });
  const file = commentsFile(book.root, o.page);
  const existing = readComments(file);
  if (o.replyTo && !existing.some((c) => c.id === o.replyTo)) {
    throw new RedocsError(`No comment '${o.replyTo}' to reply to on '${o.page}'`, { code: 'ERR_REDOCS_ARGS' });
  }
  const comment = {
    id: nextCommentId(existing),
    author: o.author,
    created: o.created || new Date().toISOString(),
    body: o.body,
  };
  if (o.anchor) comment.anchor = o.anchor;
  if (o.replyTo) comment.reply_to = o.replyTo;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(comment)}\n`);
  return { ok: true, command: 'comment', page: o.page, comment: comment.id, modified: [`comments/${o.page}.jsonl`] };
}

/**
 * Mark a comment resolved (or reopen it with reopen:true). Rewrites the file so the flag persists.
 * @param {{book: string, page: string, id: string, reopen?: boolean}} o
 */
export function resolveComment(o) {
  const book = loadBook(o.book);
  const file = commentsFile(book.root, o.page);
  const existing = readComments(file);
  const target = existing.find((c) => c.id === o.id);
  if (!target) throw new RedocsError(`No comment '${o.id}' on '${o.page}'`, { code: 'ERR_REDOCS_ARGS' });
  if (o.reopen) delete target.resolved;
  else target.resolved = true;
  writeFileSync(file, existing.map((c) => JSON.stringify(c)).join('\n') + '\n');
  return { ok: true, command: 'comment', page: o.page, comment: o.id, resolved: !o.reopen, modified: [`comments/${o.page}.jsonl`] };
}

/**
 * List a page's comments (or every page's, when page is omitted).
 * @param {{book: string, page?: string}} o
 */
export function listComments(o) {
  const book = loadBook(o.book);
  const pages = o.page ? [o.page] : [...book.comments.keys()].sort();
  const threads = pages.map((id) => ({
    page: id,
    comments: (book.comments.get(id) || []).map((c) => ({ id: c.id, author: c.author, created: c.created, resolved: c.resolved, reply_to: c.reply_to, body: c.body })),
  }));
  const total = threads.reduce((n, t) => n + t.comments.length, 0);
  return { ok: true, command: 'comment', threads, total, summary: `OK comment list: ${total} comment(s) across ${threads.length} page(s)` };
}
