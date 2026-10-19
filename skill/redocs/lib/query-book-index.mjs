// Node entry to the agent query engine. The engine itself is the reader's classic script
// assets/theme/redocs-query.js (one implementation for the browser chat, the CLI and MCP);
// importing it runs it once and it publishes globalThis.RedocsQuery.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import '../assets/theme/redocs-query.js';
import { buildAgentIndexes } from './build-agent-index.mjs';
import { currentMilestone } from './milestone-order-and-lifecycle.mjs';
import { loadBook } from './load-book-from-directory.mjs';
import { renderBookPages } from './render-book-pages.mjs';
import { RedocsError } from './shared-helpers.mjs';

export const RedocsQuery = globalThis.RedocsQuery;
export const { TOOL_SPECS, dispatch } = RedocsQuery;

const SKIP_DIRS = new Set(['dist', '.git', 'node_modules']);

/** Cheap change detector: relative path, size and mtime of every book source file. */
function fingerprint(root) {
  const parts = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') && name !== '.') continue;
      if (!rel && SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full, `${rel}${name}/`);
      else parts.push(`${rel}${name}:${s.size}:${s.mtimeMs}`);
    }
  })(root, '');
  return parts.join('|');
}

const cache = new Map();

/**
 * Load (or reuse) the agent indexes of a book. Rebuilt only when a source file changed, so a
 * long-lived MCP server sees the agent's own edits on the next call.
 * @returns {{book: object, indexes: Map<string, object>, current: string, diagnostics: object[]}}
 */
export function loadAgentIndexes(bookDir) {
  const root = path.resolve(bookDir);
  const print = fingerprint(root);
  const hit = cache.get(root);
  if (hit && hit.print === print) return hit.value;
  const book = loadBook(root);
  if (!book.config) throw new RedocsError('book.json is unreadable; run `redocs check` for details', { code: 'ERR_REDOCS_BOOK_JSON', diagnostics: book.diagnostics });
  const { pages, diagnostics } = renderBookPages(book);
  const value = { book, indexes: buildAgentIndexes(book, pages), current: currentMilestone(book.milestones).id, diagnostics };
  cache.set(root, { print, value });
  return value;
}

/** The index for one milestone (default: current); unknown milestones are a usage error. */
export function agentIndexFor(bookDir, milestone) {
  const loaded = loadAgentIndexes(bookDir);
  const id = milestone || loaded.current;
  const index = loaded.indexes.get(id);
  if (!index) {
    throw new RedocsError(`Unknown milestone '${id}'`, { code: 'ERR_REDOCS_ARGS', hint: `Milestones: ${[...loaded.indexes.keys()].join(', ')}` });
  }
  return index;
}
