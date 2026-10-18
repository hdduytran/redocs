// Shared helpers: diagnostics, safe paths, stable JSON I/O, hashing and HTML escaping.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ID_PATTERNS = {
  slug: /^[a-z0-9][a-z0-9-]*$/,
  pageId: /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/,
  entityId: /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/,
};

/**
 * A diagnostic is the single error/warning shape used by every command.
 * @typedef {{code: string, severity: 'error'|'warning', file?: string, pointer?: string,
 *            line?: number, message: string, hint?: string}} Diagnostic
 */
export function diagnostic(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

export class RedocsError extends Error {
  constructor(message, { code = 'ERR_REDOCS', diagnostics = [], hint } = {}) {
    super(message);
    this.code = code;
    this.diagnostics = diagnostics;
    this.hint = hint;
  }
}

/** Join `relative` under `root` and refuse anything that escapes it (path traversal guard). */
export function resolveInside(root, relative) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, relative);
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
    throw new RedocsError(`Path escapes the book directory: ${relative}`, { code: 'ERR_REDOCS_PATH' });
  }
  return target;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Read and parse JSON; parse failures become an RD000 diagnostic instead of a crash. */
export function readJsonFile(file, relativeTo) {
  const shown = relativeTo ? toPosix(path.relative(relativeTo, file)) : file;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, diagnostic: diagnostic('RD000', 'error', `Cannot read file: ${error.message}`, { file: shown }) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, diagnostic: diagnostic('RD000', 'error', `Invalid JSON: ${error.message}`, { file: shown }) };
  }
}

/** Write JSON with 2-space indentation and a trailing newline so diffs stay stable. */
export function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256File(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
