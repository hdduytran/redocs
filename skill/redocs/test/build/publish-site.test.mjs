// The committed, self-updating published site: book.json publish.dir, finalize keeping it in sync,
// RD015 staleness, the build.json source stamp, and pack preferring the published copy. The browser
// check is skipped (allowed) so these run without Chrome.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkBook } from '../../lib/command-check-book.mjs';
import { buildBook } from '../../lib/command-build-book-site.mjs';
import { finalizeBook } from '../../lib/command-finalize-book.mjs';
import { packBook } from '../../lib/command-pack-book-zip.mjs';
import { BUILD_STAMP, hashSources, publishDir, publishedSourceHash } from '../../lib/publish-site.mjs';
import { editJson, readJson, starterBook, writeText } from '../helpers/make-temp-book.mjs';

const RD015 = (dir) => checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD015');

test('publishDir: parses, defaults off, and rejects dangerous values', () => {
  assert.equal(publishDir({}), null);
  assert.equal(publishDir({ publish: { dir: 'site' } }), 'site');
  assert.equal(publishDir({ publish: { dir: 'public/' } }), 'public');
  for (const bad of ['', '.', 'dist', 'dist/x', '../escape']) {
    assert.throws(() => publishDir({ publish: { dir: bad } }), { code: 'ERR_REDOCS_ARGS' }, `rejects '${bad}'`);
  }
});

test('build writes a deterministic source-hash stamp into dist/_redocs/build.json', () => {
  const dir = starterBook();
  const build = buildBook({ book: dir });
  const stampFile = path.join(build.dist, BUILD_STAMP);
  assert.ok(existsSync(stampFile), 'build.json written');
  const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
  assert.match(stamp.sourceHash, /^sha256:/);
  assert.equal(stamp.sourceHash, build.sourceHash);
  assert.equal(stamp.sourceHash, hashSources(dir, readJson(path.join(dir, 'book.json'))));
  // Rebuilding the same sources gives the same hash (deterministic; no timestamp).
  assert.equal(buildBook({ book: dir }).sourceHash, build.sourceHash);
});

test('finalize copies dist/ into publish.dir and clears RD015', async () => {
  const dir = starterBook(); // starter ships publish.dir "site"
  assert.equal(publishDir(readJson(path.join(dir, 'book.json'))), 'site');
  assert.equal(RD015(dir).length, 1, 'unbuilt book: RD015 missing-site warning');

  const r = await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  assert.equal(r.ok, true, r.summary);
  assert.ok(r.publish, 'publish recorded in receipt');
  assert.equal(r.publish.dir, 'site');
  const siteIndex = path.join(dir, 'site', 'index.html');
  assert.ok(existsSync(siteIndex), 'site/index.html committed copy exists');
  assert.ok(existsSync(path.join(dir, 'site', BUILD_STAMP)), 'stamp travels into site/');
  // The finalize receipt is copied in too and records dist as a RELATIVE path (no machine path).
  const receipt = JSON.parse(readFileSync(path.join(dir, 'site', 'finalize-receipt.json'), 'utf8'));
  assert.equal(receipt.build.dist, 'dist');
  assert.ok(!path.isAbsolute(receipt.build.dist));
  assert.equal(RD015(dir).length, 0, 'fresh published site: no RD015');
  assert.equal(publishedSourceHash(dir, 'site'), hashSources(dir, readJson(path.join(dir, 'book.json'))));
});

test('RD015 fires again once a source changes after publishing', async () => {
  const dir = starterBook();
  await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  assert.equal(RD015(dir).length, 0);
  writeText(path.join(dir, 'pages/vision/why/index.md'), '# Why\n\nNew content that was never rebuilt.\n');
  const stale = RD015(dir);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].severity, 'warning');
  assert.match(stale[0].message, /stale/);
  // Finalizing again republishes and clears it.
  await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  assert.equal(RD015(dir).length, 0);
});

test('a book without publish.dir keeps the old behaviour: no site/, no RD015', async () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { delete c.publish; });
  assert.equal(RD015(dir).length, 0);
  const r = await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  assert.equal(r.ok, true, r.summary);
  assert.equal(r.publish, null);
  assert.ok(!existsSync(path.join(dir, 'site')), 'no publish folder created');
});

test('an invalid publish.dir is an RD015 error and finalize does not publish', async () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { c.publish = { dir: 'dist' }; });
  const diag = RD015(dir);
  assert.equal(diag.length, 1);
  assert.equal(diag[0].severity, 'error');
});

test('pack zips the committed publish copy when present, else dist/', async () => {
  const dir = starterBook();
  // Before publishing: pack falls back to dist/ (built by pack's precondition via build).
  buildBook({ book: dir });
  const fromDist = await packBook({ book: dir, out: path.join(dir, 'dist.zip') });
  assert.ok(fromDist.ok);
  // After publishing: pack uses site/.
  await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  const fromSite = await packBook({ book: dir, out: path.join(dir, 'site.zip') });
  assert.ok(fromSite.ok);
  // Both zips root at <id>-book/index.html.
  assert.match(fromSite.summary, /index\.html/);
});

test('query/MCP source fingerprint ignores the publish folder', async () => {
  const dir = starterBook();
  await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  const { loadAgentIndexes } = await import('../../lib/query-book-index.mjs');
  const first = loadAgentIndexes(dir);
  // Re-publishing (which rewrites every file under site/) must not count as a source change.
  await finalizeBook({ book: dir, skipBrowser: true, allowSkipBrowser: true });
  const second = loadAgentIndexes(dir);
  assert.equal(first, second, 'cache reused: site/ churn is not a source change');
});
