// `redocs upgrade <book> [--apply] [--to <version>] [--force]`: bring a book written with an
// older ReDocs up to this skill's version, following lib/upgrade-migrations.mjs (CHANGELOG.md
// in prose). Without --apply it only reports the plan. Applying needs a clean Git tree (Git is
// the undo), runs only idempotent "auto" steps, stamps book.json "redocsVersion", then checks.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkBookModel } from './command-check-book.mjs';
import { loadBook } from './load-book-from-directory.mjs';
import { bookVersion, compareVersions, REDOCS_VERSION } from './redocs-version.mjs';
import { RedocsError, resolveInside } from './shared-helpers.mjs';
import { MIGRATIONS } from './upgrade-migrations.mjs';

function gitState(root) {
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return { repo: false, dirty: [] };
  return { repo: true, dirty: r.stdout.split('\n').filter(Boolean) };
}

function makeContext(root, written) {
  const book = loadBook(root);
  return {
    root,
    book,
    config: book.config,
    exists: (rel) => existsSync(resolveInside(root, rel)),
    readText: (rel) => readFileSync(resolveInside(root, rel), 'utf8'),
    writeText: (rel, text) => {
      const file = resolveInside(root, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
      if (!written.includes(rel)) written.push(rel);
    },
  };
}

/** Set "redocsVersion" in book.json as a text edit, so the owner's formatting is kept. */
function stampVersion(ctx, version) {
  const text = ctx.readText('book.json');
  let next;
  if (/"redocsVersion"\s*:\s*"[^"]*"/.test(text)) {
    next = text.replace(/("redocsVersion"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  } else if (/^([ \t]*)"schemaVersion"\s*:\s*\d+\s*,[ \t]*$/m.test(text)) {
    next = text.replace(/^([ \t]*)("schemaVersion"\s*:\s*\d+\s*,)[ \t]*$/m, `$1$2\n$1"redocsVersion": "${version}",`);
  } else {
    next = `${JSON.stringify({ ...JSON.parse(text), redocsVersion: version }, null, 2)}\n`;
  }
  ctx.writeText('book.json', next);
}

function evaluate(step, ctx) {
  const needed = step.needed(ctx);
  const items = needed && typeof needed === 'object' ? needed.items : undefined;
  if (!needed) return { status: 'done' };
  if (step.kind === 'auto') return { status: 'apply', items };
  return { status: step.kind === 'owner' ? 'todo' : 'available', items };
}

const STATUS_LABEL = { apply: 'will apply', applied: 'applied', done: 'already done', todo: 'owner', available: 'optional' };

export function upgradeBook({ book: bookDir, apply = false, to, force = false }) {
  const root = path.resolve(bookDir);
  const written = [];
  const ctx = makeContext(root, written);
  if (!ctx.config) throw new RedocsError('book.json is unreadable; run `redocs check` for details', { code: 'ERR_REDOCS_BOOK_JSON', diagnostics: ctx.book.diagnostics });
  const from = bookVersion(ctx.config);
  const target = to || REDOCS_VERSION;
  if (!MIGRATIONS.some((m) => m.version === target) || compareVersions(target, REDOCS_VERSION) > 0) {
    throw new RedocsError(`Unknown target version '${target}'`, { code: 'ERR_REDOCS_ARGS', hint: `Known: ${MIGRATIONS.map((m) => m.version).join(', ')} (this skill is ${REDOCS_VERSION})` });
  }
  if (compareVersions(from, REDOCS_VERSION) > 0) {
    throw new RedocsError(`This book was written with ReDocs ${from}, newer than this skill (${REDOCS_VERSION})`, { code: 'ERR_REDOCS_VERSION', hint: 'Update the ReDocs skill instead of downgrading the book.' });
  }
  if (compareVersions(target, from) < 0) {
    throw new RedocsError(`Cannot downgrade from ${from} to ${target}`, { code: 'ERR_REDOCS_ARGS', hint: 'Use Git to return to an older state of the book.' });
  }

  const pending = MIGRATIONS.filter((m) => compareVersions(m.version, from) > 0 && compareVersions(m.version, target) <= 0);
  const plan = pending.flatMap((m) => m.steps.map((step) => ({ version: m.version, id: step.id, kind: step.kind, title: step.title, ...evaluate(step, ctx) })));
  const versions = pending.map((m) => ({ version: m.version, date: m.date, summary: m.summary }));
  const upToDate = from === target;

  let gitNote = '';
  if (apply && !upToDate) {
    const git = gitState(root);
    if (git.dirty.length && !force) {
      throw new RedocsError(`The book has uncommitted changes (${git.dirty.length} path(s)); commit or stash them first so the upgrade is one reviewable diff`, {
        code: 'ERR_REDOCS_DIRTY', hint: 'Or pass --force to upgrade on top of them.',
      });
    }
    if (!git.repo) gitNote = '\n  note: the book is not a Git repository, so these changes cannot be reviewed or undone with Git';
    for (const entry of plan.filter((p) => p.status === 'apply')) {
      const migration = pending.find((m) => m.version === entry.version);
      const step = migration.steps.find((s) => s.id === entry.id);
      const fresh = makeContext(root, written); // earlier steps may have changed files
      if (!step.needed(fresh)) { entry.status = 'done'; continue; }
      step.apply(fresh);
      entry.status = 'applied';
    }
    stampVersion(makeContext(root, written), target);
  }

  const check = apply && !upToDate ? checkBookModel(root) : null;
  const ok = !check || check.ok;
  const lines = [];
  if (upToDate) {
    lines.push(`OK upgrade: ${root} is already at ReDocs ${target}.`);
  } else {
    lines.push(`${apply ? (ok ? 'OK upgrade' : 'FAILED upgrade') : 'PLAN upgrade'}: ReDocs ${from} -> ${target} for ${root}`);
    for (const v of versions) {
      lines.push('', `${v.version} (${v.date}): ${v.summary}`);
      const steps = plan.filter((p) => p.version === v.version);
      if (!steps.length) lines.push('  (nothing to change in books)');
      for (const p of steps) {
        lines.push(`  [${STATUS_LABEL[p.status]}] ${p.id}: ${p.title}`);
        for (const item of (p.items || []).slice(0, 10)) lines.push(`      - ${item}`);
        if (p.items && p.items.length > 10) lines.push(`      … and ${p.items.length - 10} more`);
      }
    }
    lines.push('', apply
      ? `  changed: ${written.join(', ') || '(none)'}\n  check: ${check.errors} error(s), ${check.warnings} warning(s)${ok ? '' : ' — run `redocs check` and fix the errors'}${gitNote}`
      : '  Run again with --apply to make the [will apply] changes. Owner and optional items are never changed automatically.');
    lines.push('  Release notes: <skill-dir>/CHANGELOG.md');
  }
  return {
    ok,
    command: 'upgrade',
    summary: lines.join('\n'),
    from,
    to: target,
    upToDate,
    applied: Boolean(apply && !upToDate),
    versions,
    plan,
    changedFiles: written,
    check: check ? { ok: check.ok, errors: check.errors, warnings: check.warnings } : null,
    diagnostics: check ? check.diagnostics.filter((d) => d.severity === 'error') : [],
  };
}
