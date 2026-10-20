// `redocs ci`: GitHub + GitLab release pipelines that zip the committed publish folder on a tag.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ciPipelineFiles, writeCiPipelines } from '../../lib/command-ci-pipelines.mjs';
import { editJson, readJson, starterBook } from '../helpers/make-temp-book.mjs';

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GH = '.github/workflows/redocs-release.yml';
const GL = '.gitlab-ci.yml';

test('init scaffolds both release pipelines for the book id', () => {
  const dir = starterBook('acme');
  const gh = readFileSync(path.join(dir, GH), 'utf8');
  const gl = readFileSync(path.join(dir, GL), 'utf8');
  assert.match(gh, /on:\n\s+push:\n\s+tags:\n\s+- 'v\*'/);
  assert.match(gh, /acme-book\.zip/);
  assert.match(gh, /site\/index\.html/, 'guards on the committed publish folder');
  assert.match(gl, /\$CI_COMMIT_TAG =~ \/\^v\//);
  assert.match(gl, /acme-book\.zip/);
  assert.match(gl, /JOB-TOKEN/);
});

test('pipelines follow a custom publish.dir', () => {
  const files = ciPipelineFiles('acme', 'public', 'both');
  assert.equal(files.length, 2);
  for (const f of files) assert.match(f.content, /public\/index\.html/);
  assert.ok(!files.some((f) => /\bsite\/index\.html/.test(f.content)));
});

test('ci command: provider selection, skip-exists and --force', () => {
  const dir = starterBook();
  // init already wrote both; default run skips both.
  const first = writeCiPipelines({ book: dir });
  assert.deepEqual(first.written, []);
  assert.deepEqual(first.skipped.sort(), [GH, GL].sort());
  // --force rewrites.
  assert.deepEqual(writeCiPipelines({ book: dir, force: true }).written.sort(), [GH, GL].sort());
  // Only one provider.
  const gh = writeCiPipelines({ book: dir, provider: 'github', force: true });
  assert.deepEqual(gh.written, [GH]);
  assert.throws(() => writeCiPipelines({ book: dir, provider: 'bitbucket' }), { code: 'ERR_REDOCS_ARGS' });
});

test('ci command warns when the book has no publish.dir but still targets site/', () => {
  const dir = starterBook();
  editJson(path.join(dir, 'book.json'), (c) => { delete c.publish; });
  const r = writeCiPipelines({ book: dir, force: true });
  assert.equal(r.publishDir, 'site');
  assert.match(r.summary, /no "publish\.dir"/);
  assert.match(readFileSync(path.join(dir, GH), 'utf8'), /site\/index\.html/);
});

test('CLI: redocs ci writes files and reports them', () => {
  const dir = starterBook();
  const cli = (...args) => spawnSync(process.execPath, [path.join(skillDir, 'bin/redocs.mjs'), ...args], { encoding: 'utf8' });
  const r = cli('ci', dir, '--provider', 'gitlab', '--force', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.written, [GL]);
  assert.ok(existsSync(path.join(dir, GL)));
});
