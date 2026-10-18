import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { findChrome } from '../../lib/chrome-cdp-file-protocol-check.mjs';
import { checkBook } from '../../lib/command-check-book.mjs';
import { embedArtifact, refreshStaleArtifacts } from '../../lib/command-embed-artifact.mjs';
import { finalizeBook } from '../../lib/command-finalize-book.mjs';
import { findArchify } from '../../plugins/archify/adapter-archify-finalize.mjs';
import { starterBook, tempDir, writeText } from '../helpers/make-temp-book.mjs';

const WIREFRAME = '<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head><body><h1>Sign in</h1></body></html>';

function bookWithEmbed(id) {
  const dir = starterBook();
  writeText(path.join(dir, 'pages/vision/why/index.md'), `# Why\n\n\`\`\`redocs-embed\n{"artifact": "${id}", "caption": "Wireframe"}\n\`\`\`\n`);
  return dir;
}

test('html plugin: embed writes spec, output and a fresh receipt', async () => {
  const dir = bookWithEmbed('login');
  const spec = path.join(tempDir(), 'login.html');
  writeText(spec, WIREFRAME);
  const result = await embedArtifact({ book: dir, plugin: 'html', artifactId: 'login', spec });
  assert.equal(result.ok, true, result.summary);
  const receipt = JSON.parse(readFileSync(path.join(dir, 'artifacts/login/receipt.json'), 'utf8'));
  assert.equal(receipt.title, 'Login');
  assert.match(receipt.inputHash, /^sha256:/);
  assert.equal(checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD007').length, 0);
});

test('editing the spec makes it stale; --refresh-stale fixes it', async () => {
  const dir = bookWithEmbed('login');
  const spec = path.join(tempDir(), 'login.html');
  writeText(spec, WIREFRAME);
  await embedArtifact({ book: dir, plugin: 'html', artifactId: 'login', spec });
  writeText(path.join(dir, 'artifacts/login/spec.html'), WIREFRAME.replace('Sign in', 'Log in'));
  assert.ok(checkBook({ book: dir }).diagnostics.some((d) => d.code === 'RD007' && /stale/.test(d.message)));
  const refresh = await refreshStaleArtifacts({ book: dir });
  assert.deepEqual(refresh.refreshed, ['login']);
  assert.match(readFileSync(path.join(dir, 'artifacts/login/login.html'), 'utf8'), /Log in/);
  assert.equal(checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD007').length, 0);
});

test('a failed render keeps the previous output and records the error', async () => {
  const dir = bookWithEmbed('login');
  const spec = path.join(tempDir(), 'login.html');
  writeText(spec, WIREFRAME);
  await embedArtifact({ book: dir, plugin: 'html', artifactId: 'login', spec });
  writeText(spec, '<!doctype html><html><body><script src="https://cdn.example.com/x.js"></script></body></html>');
  const failed = await embedArtifact({ book: dir, plugin: 'html', artifactId: 'login', spec });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /RD009/);
  assert.match(readFileSync(path.join(dir, 'artifacts/login/login.html'), 'utf8'), /Sign in/);
  assert.ok(checkBook({ book: dir }).diagnostics.some((d) => /Last render of 'login' failed/.test(d.message)));
});

test('embed rejects bad ids, wrong spec type, unknown plugins and book plugins without consent', async () => {
  const dir = starterBook();
  const spec = path.join(tempDir(), 'x.html');
  writeText(spec, WIREFRAME);
  await assert.rejects(embedArtifact({ book: dir, plugin: 'html', artifactId: '../x', spec }), { code: 'ERR_REDOCS_ARGS' });
  await assert.rejects(embedArtifact({ book: dir, plugin: 'archify', artifactId: 'x', spec }), /expects a \.json spec/);
  await assert.rejects(embedArtifact({ book: dir, plugin: 'nope', artifactId: 'x', spec }), /Unknown plugin/);
  writeText(path.join(dir, 'tools/p/plugin.json'), JSON.stringify({ name: 'p', version: '1', description: 'd', output: 'html-standalone', adapter: 'a.mjs' }));
  writeText(path.join(dir, 'tools/p/a.mjs'), 'export async function render(){ return { ok: true }; }');
  const config = JSON.parse(readFileSync(path.join(dir, 'book.json'), 'utf8'));
  config.plugins = { p: { manifest: 'tools/p/plugin.json' } };
  writeText(path.join(dir, 'book.json'), JSON.stringify(config));
  await assert.rejects(embedArtifact({ book: dir, plugin: 'p', artifactId: 'x', spec }), (error) => error.code === 'ERR_REDOCS_PLUGIN' && /--allow-book-plugins/.test(error.hint));
});

const chrome = findChrome();
const archify = findArchify(null);

test('archify plugin renders a real diagram', { skip: !(chrome && archify) && 'archify or Chrome not installed' }, async () => {
  const dir = bookWithEmbed('seq');
  const spec = path.join(tempDir(), 'seq.json');
  writeText(spec, readFileSync(path.join(archify, 'examples/cache-miss-request.sequence.json'), 'utf8'));
  const result = await embedArtifact({ book: dir, plugin: 'archify', artifactId: 'seq', spec, options: { type: 'sequence' } });
  assert.equal(result.ok, true, result.summary);
  assert.ok(existsSync(path.join(dir, 'artifacts/seq/seq.html')));
  const receipt = JSON.parse(readFileSync(path.join(dir, 'artifacts/seq/receipt.json'), 'utf8'));
  assert.equal(receipt.pluginReceipt.status, 'pass');
  assert.equal(receipt.pluginReceipt.update, undefined, 'notices are relayed, not stored');
});

test('finalize: check + build + file:// browser check pass on the starter book', { skip: !chrome && 'Chrome not installed' }, async () => {
  const dir = starterBook();
  const result = await finalizeBook({ book: dir });
  assert.equal(result.ok, true, `${result.summary}\n${JSON.stringify(result.browser, null, 2)}`);
  assert.equal(result.browser.consoleErrors, 0);
  assert.ok(existsSync(path.join(dir, 'dist/finalize-receipt.json')));
});

test('finalize stops at check and refuses an unapproved browser skip', async () => {
  const dir = starterBook();
  writeText(path.join(dir, 'pages/vision/why/index.md'), '# Why\n\n[[svc:ghost]]\n');
  const failed = await finalizeBook({ book: dir });
  assert.equal(failed.ok, false);
  assert.equal(failed.build, null);
  const clean = starterBook();
  assert.equal((await finalizeBook({ book: clean, skipBrowser: true })).ok, false);
  assert.equal((await finalizeBook({ book: clean, skipBrowser: true, allowSkipBrowser: true })).ok, true);
});
