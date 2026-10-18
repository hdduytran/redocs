import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { diffMilestones } from '../../lib/build-generated-pages.mjs';
import { addEntity, addVariant } from '../../lib/command-add-page-entity-variant.mjs';
import { buildBook } from '../../lib/command-build-book-site.mjs';
import { packBook } from '../../lib/command-pack-book-zip.mjs';
import { promoteMilestone } from '../../lib/command-promote-milestone.mjs';
import { loadBook } from '../../lib/load-book-from-directory.mjs';
import { editJson, readJson, starterBook, writeText } from '../helpers/make-temp-book.mjs';

function threeMilestoneBook() {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => {
    c.milestones.splice(1, 0, { id: 'v2', label: 'v2', status: 'planned' });
  });
  addEntity({ book: dir, id: 'svc:gateway', type: 'service', name: 'Gateway' });
  addEntity({ book: dir, id: 'svc:monolith', type: 'service', name: 'Monolith', until: 'v2', replacedBy: 'svc:billing' });
  addEntity({ book: dir, id: 'svc:billing', type: 'service', name: 'Billing', since: 'v2' });
  addEntity({ book: dir, id: 'svc:legacy-cron', type: 'service', name: 'Legacy cron', until: 'target' });
  addVariant({ book: dir, page: 'network/topology', milestone: 'v2' });
  writeText(path.join(dir, 'pages/network/topology/v2.md'), '# Topology v2\n\n## Zones\n\n[[svc:billing]] lives in the private zone. [Vision](page:vision/why).\n');
  return dir;
}

function allFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f); else out.push(f);
    }
  })(dir);
  return out;
}

test('build writes every milestone tree, redirect and shared theme', () => {
  const dir = threeMilestoneBook();
  const result = buildBook({ book: dir });
  const dist = path.join(dir, 'dist');
  for (const m of ['v1', 'v2', 'target']) {
    assert.ok(existsSync(path.join(dist, m, 'index.html')));
    assert.ok(existsSync(path.join(dist, m, 'network/topology.html')));
    assert.ok(existsSync(path.join(dist, m, 'search-index.js')));
  }
  assert.match(readFileSync(path.join(dist, 'index.html'), 'utf8'), /url=v1\/index\.html/);
  assert.ok(existsSync(path.join(dist, '_redocs/redocs.css')));
  assert.equal(result.milestones.length, 3);
});

test('build is deterministic', () => {
  const dir = threeMilestoneBook();
  const first = buildBook({ book: dir }).distHash;
  const second = buildBook({ book: dir }).distHash;
  assert.equal(first, second);
});

test('output uses only relative, offline URLs and never fetch()', () => {
  const dir = threeMilestoneBook();
  buildBook({ book: dir });
  for (const file of allFiles(path.join(dir, 'dist')).filter((f) => /\.(html|js|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      assert.doesNotMatch(m[1], /^(\/|file:|https?:\/\/)/, `${path.relative(dir, file)}: ${m[1]}`);
    }
    assert.doesNotMatch(text, /\bfetch\(/, path.relative(dir, file));
  }
});

test('variants: inherited notice, milestone switcher and compare page', () => {
  const dir = threeMilestoneBook();
  buildBook({ book: dir });
  const dist = path.join(dir, 'dist');
  const v2 = readFileSync(path.join(dist, 'v2/network/topology.html'), 'utf8');
  assert.match(v2, /Topology v2/);
  assert.match(v2, /href="\.\.\/\.\.\/target\/network\/topology\.html"/);
  assert.match(v2, /aria-current="true"[^>]*>v2</);
  assert.ok(existsSync(path.join(dist, 'v2/compare/network/topology/v1-vs-v2.html')));
  assert.ok(existsSync(path.join(dist, 'target/compare/network/topology/v2-vs-target.html')));
  // vision/why has no variants: rendered at every milestone, no compare page.
  assert.ok(!existsSync(path.join(dist, 'v2/compare/vision')));
});

test('catalog is milestone-aware; changes page lists added / replaced / removed', () => {
  const dir = threeMilestoneBook();
  buildBook({ book: dir });
  const dist = path.join(dir, 'dist');
  const v1 = readFileSync(path.join(dist, 'v1/catalog/service.html'), 'utf8');
  const aliveV1 = v1.split('not-at-this-milestone')[0];
  assert.match(aliveV1, /Monolith/);
  assert.doesNotMatch(aliveV1, /id="svc-billing"/);
  const d = diffMilestones(loadBook(dir), 'v1', 'v2');
  assert.deepEqual(d.added.map((e) => e.id), ['svc:billing']);
  assert.deepEqual(d.replaced.map((e) => e.id), ['svc:monolith']);
  assert.deepEqual(d.removed.map((e) => e.id), []);
  assert.deepEqual(d.changedPages, ['network/topology']);
  const toTarget = diffMilestones(loadBook(dir), 'v2', 'target');
  assert.deepEqual(toTarget.removed.map((e) => e.id), ['svc:legacy-cron']);
  assert.match(readFileSync(path.join(dist, 'v2/changes/v1-to-v2.html'), 'utf8'), /Monolith[\s\S]*→[\s\S]*Billing/);
  // current (v1) -> target is not adjacent, so it gets its own page too.
  assert.ok(existsSync(path.join(dist, 'target/changes/v1-to-target.html')));
});

test('search index has pages and entities with milestone-relative urls', () => {
  const dir = threeMilestoneBook();
  buildBook({ book: dir });
  const js = readFileSync(path.join(dir, 'dist/v2/search-index.js'), 'utf8');
  const data = JSON.parse(js.replace(/^window\.__REDOCS_SEARCH=/, '').replace(/;\s*$/, ''));
  assert.ok(data.some((d) => d.u === 'network/topology.html' && /Topology v2/.test(d.x)));
  assert.ok(data.some((d) => d.u === 'catalog/service.html#svc-billing'));
});

test('promote moves current forward and lists what to review', () => {
  const dir = threeMilestoneBook();
  const result = promoteMilestone({ book: dir, milestone: 'v2' });
  assert.deepEqual(readJson(path.join(dir, 'book.json')).milestones.map((m) => m.status), ['superseded', 'current', 'target']);
  assert.ok(result.review.some((r) => r.includes('network/topology')));
  assert.ok(result.review.some((r) => r.includes('svc:billing')));
  assert.throws(() => promoteMilestone({ book: dir, milestone: 'v1' }), { code: 'ERR_REDOCS_ARGS' });
});

test('pack zips dist deterministically', async () => {
  const dir = threeMilestoneBook();
  buildBook({ book: dir });
  const a = await packBook({ book: dir, out: path.join(dir, 'a.zip') });
  const b = await packBook({ book: dir, out: path.join(dir, 'b.zip') });
  assert.equal(a.files, b.files);
  assert.deepEqual(readFileSync(a.zip), readFileSync(b.zip));
});
