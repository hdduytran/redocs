// One broken fixture per check rule: each must produce its code, and the clean starter none.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { addEntity } from '../../lib/command-add-page-entity-variant.mjs';
import { checkBook } from '../../lib/command-check-book.mjs';
import { RULE_CODES } from '../../lib/check-book-rules.mjs';
import { editJson, starterBook, writeText } from '../helpers/make-temp-book.mjs';

const codes = (dir, severity = 'error') => checkBook({ book: dir }).diagnostics.filter((d) => d.severity === severity).map((d) => d.code);

function withPage(dir, id, body, meta = {}) {
  writeText(path.join(dir, 'pages', id, 'page.json'), JSON.stringify({ id, title: id, kind: 'reference', ...meta }));
  writeText(path.join(dir, 'pages', id, 'index.md'), body);
  editJson(path.join(dir, 'book.json'), (c) => { c.chapters[0].pages.push(id); });
}

test('starter book: only RD011 warnings, plus RD015 until the site is built', () => {
  const result = checkBook({ book: starterBook() });
  assert.equal(result.ok, true);
  assert.equal(result.errors, 0);
  // Fresh book ships publish.dir "site" but no built site/ yet -> one RD015 "not built" warning.
  assert.ok(result.diagnostics.every((d) => d.code === 'RD011' || d.code === 'RD015'));
  assert.equal(result.diagnostics.filter((d) => d.code === 'RD015').length, 1);
  assert.equal(checkBook({ book: starterBook(), strict: true }).ok, false, 'strict turns warnings into failure');
});

test('RD000 / RD001: invalid JSON and schema violations', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'entities/services.json'), '{oops');
  editJson(path.join(dir, 'pages/vision/why/page.json'), (m) => { m.kind = 'Not Valid'; });
  const found = codes(dir);
  assert.ok(found.includes('RD000'));
  assert.ok(found.includes('RD001'));
});

test('RD002: unknown page in chapter, duplicate listing, orphan page', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { c.chapters[0].pages.push('nope/missing', 'overview/system-context'); });
  writeText(path.join(dir, 'pages/orphan/page.json'), JSON.stringify({ id: 'orphan', title: 'Orphan', kind: 'reference' }));
  writeText(path.join(dir, 'pages/orphan/index.md'), '# Orphan\n');
  const result = checkBook({ book: dir });
  const rd002 = result.diagnostics.filter((d) => d.code === 'RD002');
  assert.equal(rd002.filter((d) => d.severity === 'error').length, 2);
  assert.ok(rd002.some((d) => d.severity === 'warning' && /orphan/.test(d.message)));
});

test('RD003: unknown page link and missing anchor; valid anchor passes', () => {
  const dir = starterBook();
  withPage(dir, 'links', '# Links\n\n[a](page:nope)\n\n[b](page:vision/why#no-such-heading)\n\n[c](page:vision/why#why-this-system-exists)\n');
  const rd003 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD003');
  assert.equal(rd003.length, 2, JSON.stringify(rd003));
  assert.ok(rd003.every((d) => d.file === 'pages/links/index.md' && d.line));
});

test('RD004: unknown entity inline and in page.json', () => {
  const dir = starterBook();
  withPage(dir, 'refs', '# Refs\n\nUses [[svc:ghost]].\n', { entities: ['db:ghost'] });
  const rd004 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD004');
  assert.deepEqual(rd004.map((d) => d.file).sort(), ['pages/refs/index.md', 'pages/refs/page.json']);
});

test('RD005: variant body mentions an entity that does not exist at its milestone; shared pages may', () => {
  const dir = starterBook();
  addEntity({ book: dir, id: 'svc:future', type: 'service', name: 'Future', since: 'target' });
  writeText(path.join(dir, 'pages/network/topology/v1.md'), '# Topology\n\n[[svc:future]] is here already.\n');
  withPage(dir, 'roadmap', '# Roadmap\n\nWe will add [[svc:future]].\n');
  const rd005 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD005');
  assert.equal(rd005.length, 1);
  assert.equal(rd005[0].file, 'pages/network/topology/v1.md');
});

test('RD006: variant for unknown milestone and missing variant file', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'pages/network/topology/page.json'), (m) => { m.variants.v9 = 'v9.md'; m.variants.target = 'gone.md'; });
  const found = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD006');
  assert.ok(found.some((d) => /unknown milestone 'v9'/.test(d.message)));
  assert.ok(found.some((d) => /gone\.md/.test(d.message)));
});

test('RD006 warning: a source file the page never renders (index.md shadowing index.html)', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'pages/vision/why/index.html'), '<section><h1>Why</h1></section>');
  const unused = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD006' && d.severity === 'warning');
  assert.equal(unused.length, 1);
  assert.match(unused[0].message, /index\.html is not used/);
});

test('RD007: missing artifact, invalid block, stale spec, failed receipt', () => {
  const dir = starterBook();
  withPage(dir, 'embeds', '# Embeds\n\n```redocs-embed\n{"artifact": "nope"}\n```\n\n```redocs-embed\n{not json}\n```\n\n```redocs-embed\n{"artifact": "stale"}\n```\n');
  writeText(path.join(dir, 'artifacts/stale/spec.html'), '<html><body>v2</body></html>');
  writeText(path.join(dir, 'artifacts/stale/stale.html'), '<html><body>v1</body></html>');
  writeText(path.join(dir, 'artifacts/stale/receipt.json'), JSON.stringify({ ok: true, artifactId: 'stale', plugin: 'html', inputHash: `sha256:${'0'.repeat(64)}`, output: 'stale.html' }));
  writeText(path.join(dir, 'artifacts/broken/spec.html'), '<html></html>');
  writeText(path.join(dir, 'artifacts/broken/receipt.json'), JSON.stringify({ ok: false, artifactId: 'broken', plugin: 'html', inputHash: `sha256:${'0'.repeat(64)}`, output: 'broken.html', error: 'boom' }));
  const messages = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD007').map((d) => d.message).join('\n');
  assert.match(messages, /Artifact 'nope' not found/);
  assert.match(messages, /not valid JSON/);
  assert.match(messages, /'stale' is stale/);
  assert.match(messages, /Last render of 'broken' failed: boom/);
  assert.match(messages, /output missing: artifacts\/broken/);
  assert.match(messages, /'broken' is not embedded/);
});

test('RD008: missing asset', () => {
  const dir = starterBook();
  withPage(dir, 'pics', '# Pics\n\n![x](asset:screenshots/none.png)\n');
  assert.ok(codes(dir).includes('RD008'));
});

test('RD009: remote script/img/iframe are errors, plain links are not', () => {
  const dir = starterBook();
  withPage(dir, 'remote', '# Remote\n\n<script src="https://cdn.example.com/x.js"></script>\n\n<img src="//cdn.example.com/x.png">\n\n[docs](https://example.com)\n');
  const rd009 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD009');
  assert.equal(rd009.length, 2);
});

test('RD010: entity graph problems', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'entities/services.json'), JSON.stringify([
    { id: 'svc:a', type: 'service', name: 'A', depends_on: ['svc:missing'], replaced_by: 'svc:b' },
    { id: 'svc:c', type: 'service', name: 'C', since: 'target', until: 'v1' },
    { id: 'svc:d', type: 'service', name: 'D', since: 'v7' },
  ]));
  const rd010 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD010').map((d) => d.message).join('\n');
  assert.match(rd010, /depends on unknown entity 'svc:missing'/);
  assert.match(rd010, /replaced by unknown entity 'svc:b'/);
  assert.match(rd010, /replaced_by but no "until"/);
  assert.match(rd010, /since \(target\) must come before until \(v1\)/);
  assert.match(rd010, /unknown milestone 'v7'/);
});

test('RD012: exactly one current milestone, unique ids', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { c.milestones[1].status = 'current'; c.chapters.push({ id: 'vision', title: 'Dup', pages: [] }); });
  const rd012 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD012');
  assert.equal(rd012.length, 2);
});

test('every rule code is documented in references/check-codes.md', () => {
  const doc = readFileSync(new URL('../../references/check-codes.md', import.meta.url), 'utf8');
  for (const code of RULE_CODES) assert.match(doc, new RegExp(`\\b${code}\\b`), `${code} missing from check-codes.md`);
  const documented = [...doc.matchAll(/\bRD\d{3}\b/g)].map((m) => m[0]);
  for (const code of documented) assert.ok(RULE_CODES.includes(code), `${code} documented but not implemented`);
});
