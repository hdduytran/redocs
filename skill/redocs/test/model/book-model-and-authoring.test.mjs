import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { addEntity, addPage, addVariant } from '../../lib/command-add-page-entity-variant.mjs';
import { initBook } from '../../lib/command-init-book.mjs';
import { loadBook } from '../../lib/load-book-from-directory.mjs';
import { editJson, readJson, starterBook, tempDir, writeText } from '../helpers/make-temp-book.mjs';

test('starter book loads with no diagnostics', () => {
  const book = loadBook(starterBook());
  assert.deepEqual(book.diagnostics, []);
  assert.equal(book.pages.size, 6);
  assert.deepEqual(book.milestones.map((m) => m.id), ['v1', 'target']);
  assert.deepEqual(book.pages.get('network/topology').variants, { v1: 'v1.md', target: 'target.md' });
  assert.equal(book.pages.get('vision/why').entry, 'index.md');
});

test('init fills tokens and writes .gitignore + AGENTS.md', () => {
  const dir = path.join(tempDir(), 'shop');
  initBook({ dir, name: 'shop', title: 'Shop Platform', language: 'vi' });
  const config = readJson(path.join(dir, 'book.json'));
  assert.equal(config.id, 'shop');
  assert.equal(config.title, 'Shop Platform');
  assert.equal(config.language, 'vi');
  assert.ok(existsSync(path.join(dir, '.gitignore')));
  assert.match(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /Shop Platform/);
  assert.doesNotMatch(readFileSync(path.join(dir, 'pages/vision/why/page.json'), 'utf8'), /\{\{/);
});

test('init refuses a non-empty directory and a bad name', () => {
  const dir = tempDir();
  writeText(path.join(dir, 'README.md'), 'x');
  assert.throws(() => initBook({ dir, name: 'x' }), { code: 'ERR_REDOCS_NOT_EMPTY' });
  assert.throws(() => initBook({ dir: path.join(dir, 'y'), name: 'Bad Name' }), { code: 'ERR_REDOCS_ARGS' });
});

test('schema errors carry file and JSON pointer', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { c.milestones[0].status = 'now'; c.extra = 1; });
  const book = loadBook(dir);
  const files = book.diagnostics.map((d) => `${d.code} ${d.file} ${d.pointer}`);
  assert.ok(files.includes('RD001 book.json /milestones/0/status'), files.join('\n'));
  assert.ok(files.includes('RD001 book.json /'), files.join('\n'));
});

test('page id must match folder; invalid JSON becomes RD000', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'pages/vision/why/page.json'), (m) => { m.id = 'vision/other'; });
  writeText(path.join(dir, 'entities/services.json'), '[ not json');
  const book = loadBook(dir);
  assert.ok(book.diagnostics.some((d) => d.code === 'RD001' && d.pointer === '/id' && d.file === 'pages/vision/why/page.json'));
  assert.ok(book.diagnostics.some((d) => d.code === 'RD000' && d.file === 'entities/services.json'));
});

test('duplicate entity ids across files are reported', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'entities/services.json'), JSON.stringify([{ id: 'svc:a', type: 'service', name: 'A' }]));
  writeText(path.join(dir, 'entities/datastores.json'), JSON.stringify([{ id: 'svc:a', type: 'datastore', name: 'A again' }]));
  const book = loadBook(dir);
  assert.ok(book.diagnostics.some((d) => /Duplicate entity id 'svc:a'/.test(d.message)));
});

test('add-page registers the page in a chapter and creates sources', () => {
  const dir = starterBook();
  const result = addPage({ book: dir, id: 'data/orders-pipeline', title: 'Orders <pipeline>', kind: 'flow', variants: ['v1', 'target'], html: true });
  assert.equal(result.ok, true);
  const config = readJson(path.join(dir, 'book.json'));
  assert.deepEqual(config.chapters.at(-1), { id: 'data', title: 'Data', pages: ['data/orders-pipeline'] });
  assert.match(readFileSync(path.join(dir, 'pages/data/orders-pipeline/v1.html'), 'utf8'), /Orders &lt;pipeline&gt;/);
  assert.deepEqual(loadBook(dir).diagnostics, []);
  assert.throws(() => addPage({ book: dir, id: 'data/orders-pipeline', title: 'x', kind: 'flow' }), { code: 'ERR_REDOCS_EXISTS' });
  assert.throws(() => addPage({ book: dir, id: '../escape', title: 'x', kind: 'flow' }), { code: 'ERR_REDOCS_ARGS' });
});

test('add-entity validates milestones and writes the type file', () => {
  const dir = starterBook();
  addEntity({ book: dir, id: 'svc:billing', type: 'service', name: 'Billing', since: 'target', dependsOn: ['db:billing'] });
  addEntity({ book: dir, id: 'q:events', type: 'queue', name: 'Events' });
  assert.equal(readJson(path.join(dir, 'entities/services.json'))[0].since, 'target');
  assert.equal(readJson(path.join(dir, 'entities/queue.json'))[0].id, 'q:events');
  assert.throws(() => addEntity({ book: dir, id: 'svc:x', type: 'service', name: 'X', since: 'v9' }), { code: 'ERR_REDOCS_ARGS' });
  assert.throws(() => addEntity({ book: dir, id: 'svc:billing', type: 'service', name: 'B' }), { code: 'ERR_REDOCS_EXISTS' });
});

test('add-variant converts a shared page and copies the inherited body', () => {
  const dir = starterBook();
  const result = addVariant({ book: dir, page: 'vision/why', milestone: 'target' });
  assert.equal(result.ok, true);
  const meta = readJson(path.join(dir, 'pages/vision/why/page.json'));
  assert.deepEqual(meta.variants, { v1: 'v1.md', target: 'target.md' });
  assert.equal(meta.entry, undefined);
  assert.equal(
    readFileSync(path.join(dir, 'pages/vision/why/target.md'), 'utf8'),
    readFileSync(path.join(dir, 'pages/vision/why/v1.md'), 'utf8'),
  );
  assert.throws(() => addVariant({ book: dir, page: 'vision/why', milestone: 'target' }), { code: 'ERR_REDOCS_EXISTS' });
  assert.deepEqual(loadBook(dir).diagnostics, []);
});
