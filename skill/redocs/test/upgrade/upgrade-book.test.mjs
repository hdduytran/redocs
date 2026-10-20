// `redocs upgrade`: bring an existing book up to the skill's version following the changelog
// (lib/upgrade-migrations.mjs, CHANGELOG.md in prose). Plan by default; --apply on a clean tree.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkBook } from '../../lib/command-check-book.mjs';
import { upgradeBook } from '../../lib/command-upgrade-book.mjs';
import { compareVersions, REDOCS_VERSION } from '../../lib/redocs-version.mjs';
import { LATEST_VERSION, MIGRATIONS } from '../../lib/upgrade-migrations.mjs';
import { readJson, starterBook } from '../helpers/make-temp-book.mjs';

const skillDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Turn a fresh starter book into what `init` produced at 0.1.0. */
function oldBook() {
  const dir = starterBook('old');
  const bookFile = path.join(dir, 'book.json');
  let book = readFileSync(bookFile, 'utf8')
    .replace(/\n {2}"redocsVersion": "[^"]*",/, '')
    .replace(/\n {2}"publish": \{ "dir": "site" \},/, ''); // 0.3.0 addition
  writeFileSync(bookFile, book);
  rmSync(path.join(dir, 'README.md'), { force: true }); // 0.3.0 addition
  const agents = path.join(dir, 'AGENTS.md');
  const text = readFileSync(agents, 'utf8')
    .split('\n')
    .filter((l) => !/redocs (query|upgrade)/.test(l)) // 0.2.0 rows
    .join('\n')
    .replace(/\n## Published site\n[\s\S]*$/, '\n'); // 0.3.0 section
  writeFileSync(agents, text);
  rmSync(path.join(dir, '.github'), { recursive: true, force: true }); // 0.3.0 addition
  rmSync(path.join(dir, '.gitlab-ci.yml'), { force: true }); // 0.3.0 addition
  return dir;
}

const rd014 = (dir) => checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD014');

test('new books are stamped with the skill version and are up to date', () => {
  const dir = starterBook();
  assert.equal(readJson(path.join(dir, 'book.json')).redocsVersion, REDOCS_VERSION);
  assert.deepEqual(rd014(dir), []);
  const r = upgradeBook({ book: dir });
  assert.equal(r.upToDate, true);
  assert.match(r.summary, /already at ReDocs/);
});

test('plan only by default: lists every step by kind and touches nothing', () => {
  const dir = oldBook();
  assert.equal(rd014(dir)[0].severity, 'warning');
  const before = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8') + readFileSync(path.join(dir, 'book.json'), 'utf8');
  const r = upgradeBook({ book: dir });
  assert.equal(r.from, '0.1.0');
  assert.equal(r.to, REDOCS_VERSION);
  assert.equal(r.applied, false);
  const status = Object.fromEntries(r.plan.map((p) => [p.id, p.status]));
  assert.deepEqual(status, { 'agents-md-commands': 'apply', 'page-summaries': 'todo', 'enable-chat': 'available', 'publish-site': 'apply', 'ci-pipelines': 'apply' });
  assert.equal(r.plan.find((p) => p.id === 'page-summaries').items.length, 6);
  assert.match(r.summary, /PLAN upgrade: ReDocs 0\.1\.0 -> /);
  assert.equal(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8') + readFileSync(path.join(dir, 'book.json'), 'utf8'), before);
});

test('--apply: auto steps applied in place, version stamped, publish-site added, idempotent', () => {
  const dir = oldBook();
  const r = upgradeBook({ book: dir, apply: true });
  assert.equal(r.ok, true, r.summary);
  assert.deepEqual(r.changedFiles.sort(), ['.github/workflows/redocs-release.yml', '.gitlab-ci.yml', 'AGENTS.md', 'README.md', 'book.json']);
  assert.equal(r.plan.find((p) => p.id === 'agents-md-commands').status, 'applied');
  assert.equal(r.plan.find((p) => p.id === 'publish-site').status, 'applied');
  assert.equal(r.plan.find((p) => p.id === 'ci-pipelines').status, 'applied');
  assert.ok(readFileSync(path.join(dir, '.github/workflows/redocs-release.yml'), 'utf8').includes('action-gh-release'));
  assert.ok(readFileSync(path.join(dir, '.gitlab-ci.yml'), 'utf8').includes('release-cli'));
  const agents = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').split('\n');
  const at = (re) => agents.findIndex((l) => re.test(l));
  assert.equal(at(/redocs query/), at(/^\| Validate \|/) + 1, 'query row right after Validate');
  assert.equal(at(/redocs upgrade/), at(/^\| Share \|/) + 1, 'upgrade row right after Share');
  assert.match(agents.join('\n'), /## Published site/);
  // book.json gains the version line and the publish config, and stays valid JSON.
  const book = JSON.parse(readFileSync(path.join(dir, 'book.json'), 'utf8'));
  assert.equal(book.redocsVersion, REDOCS_VERSION);
  assert.deepEqual(book.publish, { dir: 'site' });
  // README created for readers.
  assert.match(readFileSync(path.join(dir, 'README.md'), 'utf8'), /Published site|site\/index\.html|ReDocs system design book/);
  assert.deepEqual(rd014(dir), []);
  assert.match(r.summary, /not a Git repository/);
  const again = upgradeBook({ book: dir, apply: true });
  assert.equal(again.upToDate, true);
  assert.deepEqual(again.changedFiles, []);
});

test('the upgraded AGENTS.md matches what init writes today', () => {
  const dir = oldBook();
  upgradeBook({ book: dir, apply: true });
  const fresh = starterBook('fresh-old'); // same name -> same tokens except folder
  const norm = (d) => readFileSync(path.join(d, 'AGENTS.md'), 'utf8').replace(/`(old|fresh-old)`/g, '`ID`').replace(/old|fresh-old/g, 'ID');
  assert.equal(norm(dir), norm(fresh));
});

test('a reshaped AGENTS.md gets the rows appended instead of guessed into place', () => {
  const dir = oldBook();
  writeFileSync(path.join(dir, 'AGENTS.md'), '# Our rules\n\nWe keep commands elsewhere.\n');
  upgradeBook({ book: dir, apply: true });
  const text = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(text, /^# Our rules\n\nWe keep commands elsewhere\.\n\n## Commands added by ReDocs 0\.2\.0\n\n\| Task \| Command \|\n\|---\|---\|\n\| Find where/);
  assert.match(text, /redocs upgrade/);
});

test('--apply refuses a dirty Git tree unless --force', () => {
  const dir = oldBook();
  const git = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  git('add', '-A');
  assert.equal(git('commit', '-qm', 'book').status, 0);
  writeFileSync(path.join(dir, 'pages/vision/why/index.md'), '# Why\n\nEdited.\n');
  assert.throws(() => upgradeBook({ book: dir, apply: true }), { code: 'ERR_REDOCS_DIRTY' });
  assert.equal(upgradeBook({ book: dir, apply: true, force: true }).applied, true);
  git('add', '-A');
  git('commit', '-qm', 'upgrade');
  assert.equal(git('status', '--porcelain').stdout, '');
});

test('newer books, unknown targets and downgrades are refused', () => {
  const dir = starterBook();
  const bookFile = path.join(dir, 'book.json');
  writeFileSync(bookFile, readFileSync(bookFile, 'utf8').replace(`"redocsVersion": "${REDOCS_VERSION}"`, '"redocsVersion": "9.0.0"'));
  assert.equal(rd014(dir)[0].severity, 'error');
  assert.throws(() => upgradeBook({ book: dir }), { code: 'ERR_REDOCS_VERSION' });
  const old = oldBook();
  assert.throws(() => upgradeBook({ book: old, to: '0.9.9' }), { code: 'ERR_REDOCS_ARGS' });
  const pinned = upgradeBook({ book: old, to: '0.1.0' });
  assert.equal(pinned.upToDate, true);
});

test('CLI: plan, --apply and --json', () => {
  const dir = oldBook();
  const cli = (...args) => spawnSync(process.execPath, [path.join(skillDir, 'bin/redocs.mjs'), ...args], { encoding: 'utf8' });
  const plan = cli('upgrade', dir);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /\[will apply\] agents-md-commands/);
  const applied = JSON.parse(cli('upgrade', dir, '--apply', '--json').stdout);
  assert.equal(applied.applied, true);
  assert.equal(applied.to, REDOCS_VERSION);
});

test('changelog, migrations and the skill version stay in sync', () => {
  const changelog = readFileSync(path.join(skillDir, 'CHANGELOG.md'), 'utf8');
  const sections = Object.fromEntries(changelog.split(/^## /m).slice(1).map((s) => [s.split(/\s/)[0], s]));
  assert.deepEqual(Object.keys(sections).sort(compareVersions), MIGRATIONS.map((m) => m.version), 'one CHANGELOG section per migration, same order');
  for (const m of MIGRATIONS) {
    assert.match(sections[m.version], new RegExp(`^${m.version.replace(/\./g, '\\.')} — ${m.date}`), `${m.version} date`);
    for (const step of m.steps) assert.match(sections[m.version], new RegExp(`${step.kind} \`${step.id}\``), `${m.version}: ${step.kind} ${step.id} documented`);
  }
  assert.equal(LATEST_VERSION, REDOCS_VERSION);
  assert.match(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), new RegExp(`version: "${REDOCS_VERSION}"`));
  assert.equal(readJson(path.join(skillDir, 'package-lock.json')).version, REDOCS_VERSION);
  assert.ok(MIGRATIONS.every((m, i) => i === 0 || compareVersions(MIGRATIONS[i - 1].version, m.version) < 0), 'ascending');
});
