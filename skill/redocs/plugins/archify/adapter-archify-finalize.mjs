// Archify adapter: runs archify's own `finalize` (validate, deliver, strict check, browser
// check) in a scratch folder, so archify's sidecar receipts never land in the book.

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
const TIMEOUT_MS = 300000;

function expandHome(p) {
  return p && p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
}

/** Locate archify: $REDOCS_ARCHIFY, book.json plugins.archify.path, then the default Kiro Crew skill dir. */
export function findArchify(book) {
  const candidates = [process.env.REDOCS_ARCHIFY, book?.config?.plugins?.archify?.path, '~/.kiro/crew/skills/archify', '~/.claude/skills/archify']
    .filter(Boolean)
    .map(expandHome);
  return candidates.find((dir) => existsSync(path.join(dir, 'bin', 'archify.mjs'))) || null;
}

function archifyVersion(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

export async function render({ specFile, outputFile, options, book }) {
  const type = options?.type;
  if (!TYPES.includes(type)) {
    return { ok: false, error: `archify needs --type ${TYPES.join('|')}` };
  }
  const archify = findArchify(book);
  if (!archify) {
    return { ok: false, error: 'archify skill not found. Set REDOCS_ARCHIFY or plugins.archify.path in book.json.' };
  }
  let title;
  try {
    title = JSON.parse(readFileSync(specFile, 'utf8'))?.meta?.title;
  } catch {
    return { ok: false, error: 'spec is not valid JSON' };
  }

  const work = mkdtempSync(path.join(process.env.KIROCREW_SCRATCH || tmpdir(), 'redocs-archify-'));
  try {
    const spec = path.join(work, 'candidate.json');
    const html = path.join(work, 'diagram.html');
    copyFileSync(specFile, spec);
    const env = { ...process.env };
    if (process.env.REDOCS_CHROME_NO_SANDBOX === '1') env.ARCHIFY_CHROME_NO_SANDBOX = '1';
    if (process.env.REDOCS_CHROME && !env.ARCHIFY_CHROME) env.ARCHIFY_CHROME = process.env.REDOCS_CHROME;
    let stdout = '';
    let failure;
    try {
      ({ stdout } = await run(process.execPath, [path.join(archify, 'bin', 'archify.mjs'), 'finalize', type, spec, html, '--quality', 'showcase', '--json'], {
        cwd: work, env, timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
      }));
    } catch (error) {
      stdout = error.stdout || '';
      failure = error;
    }
    let summary = null;
    try {
      summary = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || 'null');
    } catch {
      summary = null;
    }
    const compact = summary && {
      status: summary.status,
      gates: summary.gates,
      diagnostics: (summary.diagnostics || []).slice(0, 10),
      update: summary.update?.noticeRequired ? summary.update.noticeText : undefined,
      visualReviewRecommendation: summary.visualReviewRecommendation ? true : undefined,
    };
    if (failure || !summary?.ok || !existsSync(html)) {
      const first = summary?.diagnostics?.[0];
      return {
        ok: false,
        pluginVersion: archifyVersion(archify),
        title,
        error: first ? `${first.code || first.rule || 'archify'}: ${first.message || JSON.stringify(first)}` : (failure?.stderr || failure?.message || 'archify finalize failed').toString().slice(0, 800),
        pluginReceipt: compact,
      };
    }
    copyFileSync(html, outputFile);
    return { ok: true, pluginVersion: archifyVersion(archify), title, pluginReceipt: compact };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
