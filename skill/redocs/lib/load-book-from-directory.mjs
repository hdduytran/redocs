// Load a book directory into one in-memory model. Never throws for content problems:
// everything wrong is returned as diagnostics so `check` can report it all at once.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { diagnostic, readJsonFile, RedocsError, toPosix } from './shared-helpers.mjs';
import { validateAgainstSchema } from './validate-book-schemas.mjs';

/**
 * @typedef {object} Page
 * @property {string} id
 * @property {string} dir absolute folder
 * @property {string} metaFile book-relative page.json path
 * @property {object} meta parsed page.json
 * @property {string|null} entry shared source file name when there are no variants
 * @property {Record<string,string>|null} variants
 *
 * @typedef {object} Book
 * @property {string} root absolute book directory
 * @property {object} config parsed book.json
 * @property {object[]} milestones
 * @property {Map<string, Page>} pages
 * @property {Map<string, object>} entities entity id -> entity (+ _file)
 * @property {Map<string, object>} artifacts artifact id -> {id, dir, files, receipt, receiptFile}
 * @property {import('./shared-helpers.mjs').Diagnostic[]} diagnostics load + schema problems
 */

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

export function isBookDirectory(dir) {
  return existsSync(path.join(dir, 'book.json'));
}

/** @returns {Book} */
export function loadBook(bookDir) {
  const root = path.resolve(bookDir);
  const rel = (file) => toPosix(path.relative(root, file));
  if (!isBookDirectory(root)) {
    throw new RedocsError(`Not a ReDocs book (no book.json): ${root}`, {
      code: 'ERR_REDOCS_NOT_A_BOOK',
      hint: 'Run `redocs init <dir> --name <id>` first.',
    });
  }
  const diagnostics = [];

  const bookJson = readJsonFile(path.join(root, 'book.json'), root);
  if (!bookJson.ok) {
    return { root, config: null, milestones: [], pages: new Map(), entities: new Map(), artifacts: new Map(), diagnostics: [bookJson.diagnostic] };
  }
  const config = bookJson.value;
  diagnostics.push(...validateAgainstSchema('book', config, 'book.json'));
  const milestones = Array.isArray(config.milestones) ? config.milestones : [];

  // Pages: every pages/**/page.json; id = folder path relative to pages/.
  const pages = new Map();
  const pagesRoot = path.join(root, 'pages');
  for (const file of listFilesRecursive(pagesRoot).filter((f) => path.basename(f) === 'page.json')) {
    const dir = path.dirname(file);
    const folderId = toPosix(path.relative(pagesRoot, dir));
    const parsed = readJsonFile(file, root);
    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    const meta = parsed.value;
    diagnostics.push(...validateAgainstSchema('page', meta, rel(file)));
    if (meta.id !== folderId) {
      diagnostics.push(diagnostic('RD001', 'error', `Page id '${meta.id}' must equal its folder path '${folderId}'`, {
        file: rel(file), pointer: '/id', hint: `Set "id": "${folderId}" or move the folder.`,
      }));
    }
    let entry = null;
    if (!meta.variants) {
      entry = meta.entry || ['index.md', 'index.html'].find((name) => existsSync(path.join(dir, name))) || 'index.md';
    }
    pages.set(folderId, { id: folderId, dir, metaFile: rel(file), meta, entry, variants: meta.variants || null });
  }

  // Entities: each entities/*.json is an array; ids must be unique across files.
  const entities = new Map();
  for (const file of listFilesRecursive(path.join(root, 'entities')).filter((f) => f.endsWith('.json'))) {
    const parsed = readJsonFile(file, root);
    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    const schemaProblems = validateAgainstSchema('entityFile', parsed.value, rel(file));
    diagnostics.push(...schemaProblems);
    if (!Array.isArray(parsed.value)) continue;
    parsed.value.forEach((entity, index) => {
      if (!entity || typeof entity.id !== 'string') return;
      if (entities.has(entity.id)) {
        diagnostics.push(diagnostic('RD001', 'error', `Duplicate entity id '${entity.id}' (first in ${entities.get(entity.id)._file})`, {
          file: rel(file), pointer: `/${index}/id`,
        }));
        return;
      }
      entities.set(entity.id, { ...entity, _file: rel(file), _pointer: `/${index}` });
    });
  }

  // Artifacts: artifacts/<id>/ with receipt.json (+ spec + output written by `embed`).
  const artifacts = new Map();
  const artifactsRoot = path.join(root, 'artifacts');
  if (existsSync(artifactsRoot)) {
    for (const id of readdirSync(artifactsRoot).sort()) {
      const dir = path.join(artifactsRoot, id);
      if (id.startsWith('.') || !statSync(dir).isDirectory()) continue;
      const receiptFile = path.join(dir, 'receipt.json');
      let receipt = null;
      if (existsSync(receiptFile)) {
        const parsed = readJsonFile(receiptFile, root);
        if (parsed.ok) {
          receipt = parsed.value;
          diagnostics.push(...validateAgainstSchema('receipt', receipt, rel(receiptFile)));
        } else {
          diagnostics.push(parsed.diagnostic);
        }
      }
      artifacts.set(id, { id, dir, files: readdirSync(dir).sort(), receipt, receiptFile: rel(receiptFile) });
    }
  }

  return { root, config, milestones, pages, entities, artifacts, diagnostics };
}

/** Source file absolute path for a page + source name. */
export function pageSourcePath(page, fileName) {
  return path.join(page.dir, fileName);
}
