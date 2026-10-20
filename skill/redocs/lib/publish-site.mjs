// A committed, pre-built copy of the book. `book.json` `publish.dir` names a folder (default
// unset) that `finalize` keeps in sync with `dist/` so the built site travels with the repo and
// no one has to run rsync by hand. These helpers are shared by build, finalize, pack, check and
// the query index so they agree on where the folder is, how to skip it when scanning sources,
// and how to tell whether the published copy is stale.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { RedocsError, resolveInside, sha256Text, toPosix } from './shared-helpers.mjs';

// Build output and VCS/dependency folders are never book sources; the publish dir is added on top.
export const BASE_SKIP_DIRS = ['dist', '.git', 'node_modules'];

/** Where the build.json stamp lives inside dist/ and inside the published copy. */
export const BUILD_STAMP = '_redocs/build.json';

/**
 * The configured publish dir as a book-relative POSIX path, or null when the book opts out.
 * Rejects paths that escape the book or collide with dist/ or the book root.
 * @returns {string|null}
 */
export function publishDir(config) {
  const dir = config?.publish?.dir;
  if (dir === undefined || dir === null) return null;
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new RedocsError('book.json "publish.dir" must be a non-empty folder name', { code: 'ERR_REDOCS_ARGS', hint: 'e.g. "publish": { "dir": "site" }' });
  }
  const rel = toPosix(dir).replace(/\/+$/, '');
  if (rel === '' || rel === '.' || rel === 'dist' || rel.startsWith('dist/') || rel.split('/')[0] === '..') {
    throw new RedocsError(`book.json "publish.dir" is not a valid publish folder: ${dir}`, { code: 'ERR_REDOCS_ARGS', hint: 'Use a folder like "site"; it cannot be ".", "dist" or outside the book.' });
  }
  return rel;
}

/** Folder names to skip when walking book sources: the base set plus the publish dir, if any. */
export function sourceSkipSet(config) {
  const skip = new Set(BASE_SKIP_DIRS);
  const publish = publishDir(config);
  if (publish && !publish.includes('/')) skip.add(publish);
  return skip;
}

/**
 * Deterministic hash over the book's SOURCE files: relative path + bytes of every file except the
 * skipped folders and dotfiles. The published site is stale when this no longer matches the hash
 * recorded in the published build.json. Same style as hashDirectory in command-build-book-site.
 */
export function hashSources(root, config) {
  const skip = sourceSkipSet(config);
  const parts = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      if (!rel && skip.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${rel}${name}/`);
      else parts.push(`${rel}${name}\0${sha256Text(readFileSync(full))}`);
    }
  })(root, '');
  return `sha256:${sha256Text(parts.join('\n'))}`;
}

/** Read the sourceHash recorded in a published copy's build.json, or null if absent/unreadable. */
export function publishedSourceHash(root, publishRel) {
  const file = path.join(root, publishRel, BUILD_STAMP);
  if (!existsSync(file)) return null;
  try {
    const stamp = JSON.parse(readFileSync(file, 'utf8'));
    return typeof stamp.sourceHash === 'string' ? stamp.sourceHash : null;
  } catch {
    return null;
  }
}

/**
 * Replace the published folder with the freshly built dist/ (plain copy, no rmSync on anything but
 * the publish dir itself). Used by finalize AFTER the browser check has run on dist/, so dist/ is
 * never the thing being wiped.
 * @returns {number} files copied
 */
export function syncPublishDir(root, publishRel, distDir) {
  const target = resolveInside(root, publishRel);
  if (target === path.resolve(distDir)) throw new RedocsError('publish.dir cannot be dist/', { code: 'ERR_REDOCS_PATH' });
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  let count = 0;
  (function copyTree(from, to) {
    for (const name of readdirSync(from).sort()) {
      const source = path.join(from, name);
      const dest = path.join(to, name);
      if (statSync(source).isDirectory()) {
        mkdirSync(dest, { recursive: true });
        copyTree(source, dest);
      } else {
        copyFileSync(source, dest);
        count += 1;
      }
    }
  })(distDir, target);
  return count;
}
