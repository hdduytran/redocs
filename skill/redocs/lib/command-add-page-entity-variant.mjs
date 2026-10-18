// Authoring commands that keep book.json, page.json and entities/ consistent:
//   add-page, add-entity, add-variant.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBook } from './load-book-from-directory.mjs';
import { currentMilestone, resolveVariant } from './milestone-order-and-lifecycle.mjs';
import { escapeHtml, ID_PATTERNS, readJsonFile, RedocsError, resolveInside, today, writeJsonFile } from './shared-helpers.mjs';

// The starter book ships these files; other types get entities/<type>.json.
const ENTITY_FILE_BY_TYPE = {
  service: 'services',
  datastore: 'datastores',
  integration: 'integrations',
  'network-zone': 'network-zones',
};

function readBookConfig(bookDir) {
  const file = path.join(path.resolve(bookDir), 'book.json');
  const parsed = readJsonFile(file);
  if (!parsed.ok) throw new RedocsError(parsed.diagnostic.message, { code: 'ERR_REDOCS_BOOK_JSON' });
  return { file, config: parsed.value };
}

function starterBody(title, kind) {
  return `# ${title}\n\n> TODO(owner): Write the ${kind} content for this page.\n`;
}

/**
 * Create pages/<id>/page.json + source, and append the page to a chapter (created if missing).
 * @param {{book: string, id: string, title: string, kind: string, chapter?: string,
 *          chapterTitle?: string, variants?: string[], html?: boolean, standalone?: boolean}} o
 */
export function addPage(o) {
  if (!ID_PATTERNS.pageId.test(o.id || '')) throw new RedocsError(`Invalid page id '${o.id}' (use e.g. network/topology)`, { code: 'ERR_REDOCS_ARGS' });
  if (!o.title) throw new RedocsError('--title is required', { code: 'ERR_REDOCS_ARGS' });
  if (!o.kind || !/^[a-z][a-z0-9-]*$/.test(o.kind)) throw new RedocsError('--kind is required (e.g. service, flow, proposal)', { code: 'ERR_REDOCS_ARGS' });
  const root = path.resolve(o.book);
  const { file: bookFile, config } = readBookConfig(root);
  const dir = resolveInside(path.join(root, 'pages'), o.id);
  if (existsSync(path.join(dir, 'page.json'))) throw new RedocsError(`Page already exists: ${o.id}`, { code: 'ERR_REDOCS_EXISTS' });

  const ext = o.html || o.standalone ? 'html' : 'md';
  const safeTitle = escapeHtml(o.title);
  const meta = { id: o.id, title: o.title, kind: o.kind, status: 'draft', updated: today() };
  const created = [];
  if (o.variants && o.variants.length) {
    const known = new Set(config.milestones.map((m) => m.id));
    for (const v of o.variants) if (!known.has(v)) throw new RedocsError(`Unknown milestone '${v}'`, { code: 'ERR_REDOCS_ARGS' });
    meta.variants = Object.fromEntries(o.variants.map((v) => [v, `${v}.${ext}`]));
  } else if (ext === 'html') {
    meta.entry = 'index.html';
  }
  if (o.standalone) meta.standalone = true;
  writeJsonFile(path.join(dir, 'page.json'), meta);
  created.push(`pages/${o.id}/page.json`);

  const body = ext === 'md'
    ? starterBody(o.title, o.kind)
    : o.standalone
      ? `<!doctype html>\n<html lang="${config.language || 'en'}">\n<head><meta charset="utf-8"><title>${safeTitle}</title></head>\n<body>\n<h1>${safeTitle}</h1>\n<p>TODO(owner)</p>\n</body>\n</html>\n`
      : `<section>\n  <h1>${safeTitle}</h1>\n  <p>TODO(owner)</p>\n</section>\n`;
  const sources = meta.variants ? Object.values(meta.variants) : [meta.entry || 'index.md'];
  for (const name of sources) {
    writeFileSync(path.join(dir, name), body);
    created.push(`pages/${o.id}/${name}`);
  }

  const chapterId = o.chapter || o.id.split('/')[0];
  let chapter = config.chapters.find((c) => c.id === chapterId);
  if (!chapter) {
    chapter = { id: chapterId, title: o.chapterTitle || chapterId.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), pages: [] };
    config.chapters.push(chapter);
  }
  if (!chapter.pages.includes(o.id)) chapter.pages.push(o.id);
  writeJsonFile(bookFile, config);
  return { ok: true, command: 'add-page', page: o.id, chapter: chapterId, created, modified: ['book.json'] };
}

/**
 * Append an entity to entities/<type>.json.
 * @param {{book: string, id: string, type: string, name: string, summary?: string, owner?: string,
 *          since?: string, until?: string, replacedBy?: string, dependsOn?: string[], tech?: string[]}} o
 */
export function addEntity(o) {
  if (!ID_PATTERNS.entityId.test(o.id || '')) throw new RedocsError(`Invalid entity id '${o.id}' (use <prefix>:<slug>, e.g. svc:billing)`, { code: 'ERR_REDOCS_ARGS' });
  if (!o.type || !/^[a-z][a-z0-9-]*$/.test(o.type)) throw new RedocsError('--type is required (e.g. service, datastore)', { code: 'ERR_REDOCS_ARGS' });
  if (!o.name) throw new RedocsError('--name is required', { code: 'ERR_REDOCS_ARGS' });
  const book = loadBook(o.book);
  if (book.entities.has(o.id)) throw new RedocsError(`Entity already exists: ${o.id} (${book.entities.get(o.id)._file})`, { code: 'ERR_REDOCS_EXISTS' });
  const known = new Set(book.milestones.map((m) => m.id));
  for (const [flag, value] of [['--since', o.since], ['--until', o.until]]) {
    if (value && !known.has(value)) throw new RedocsError(`${flag}: unknown milestone '${value}'`, { code: 'ERR_REDOCS_ARGS' });
  }
  const fileName = `${ENTITY_FILE_BY_TYPE[o.type] || o.type}.json`;
  const file = path.join(book.root, 'entities', fileName);
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const entity = { id: o.id, type: o.type, name: o.name };
  if (o.summary) entity.summary = o.summary;
  if (o.owner) entity.owner = o.owner;
  if (o.tech?.length) entity.tech = o.tech;
  if (o.dependsOn?.length) entity.depends_on = o.dependsOn;
  if (o.since) entity.since = o.since;
  if (o.until) entity.until = o.until;
  if (o.replacedBy) entity.replaced_by = o.replacedBy;
  list.push(entity);
  writeJsonFile(file, list);
  return { ok: true, command: 'add-entity', entity: o.id, modified: [`entities/${fileName}`] };
}

/**
 * Give a page its own body for a milestone. A page without variants first turns its shared
 * entry into the current milestone's variant. The new variant starts as a copy of the variant
 * it would otherwise inherit, so authors edit a diff rather than a blank page.
 * @param {{book: string, page: string, milestone: string}} o
 */
export function addVariant(o) {
  const book = loadBook(o.book);
  const page = book.pages.get(o.page);
  if (!page) throw new RedocsError(`Unknown page '${o.page}'`, { code: 'ERR_REDOCS_ARGS' });
  if (!book.milestones.some((m) => m.id === o.milestone)) throw new RedocsError(`Unknown milestone '${o.milestone}'`, { code: 'ERR_REDOCS_ARGS' });
  const meta = JSON.parse(readFileSync(path.join(page.dir, 'page.json'), 'utf8'));
  const modified = [`pages/${page.id}/page.json`];
  const created = [];

  if (!meta.variants) {
    const current = currentMilestone(book.milestones).id;
    const entry = page.entry;
    const ext = path.extname(entry);
    const renamed = `${current}${ext}`;
    renameSync(path.join(page.dir, entry), path.join(page.dir, renamed));
    meta.variants = { [current]: renamed };
    delete meta.entry;
    modified.push(`pages/${page.id}/${renamed} (renamed from ${entry})`);
    if (current === o.milestone) {
      writeJsonFile(path.join(page.dir, 'page.json'), { ...meta, updated: today() });
      return { ok: true, command: 'add-variant', page: page.id, milestone: o.milestone, created, modified };
    }
  }
  if (meta.variants[o.milestone]) throw new RedocsError(`Page '${page.id}' already has a variant for '${o.milestone}'`, { code: 'ERR_REDOCS_EXISTS' });

  const basis = resolveVariant({ variants: meta.variants }, o.milestone, book.milestones)
    || { file: Object.values(meta.variants)[0] };
  const ext = path.extname(basis.file);
  const target = `${o.milestone}${ext}`;
  writeFileSync(path.join(page.dir, target), readFileSync(path.join(page.dir, basis.file), 'utf8'));
  created.push(`pages/${page.id}/${target} (copied from ${basis.file})`);

  // Keep variants ordered like the milestones so diffs and the UI stay predictable.
  const order = book.milestones.map((m) => m.id);
  meta.variants = Object.fromEntries(
    Object.entries({ ...meta.variants, [o.milestone]: target }).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)),
  );
  meta.updated = today();
  writeJsonFile(path.join(page.dir, 'page.json'), meta);
  return { ok: true, command: 'add-variant', page: page.id, milestone: o.milestone, created, modified };
}
