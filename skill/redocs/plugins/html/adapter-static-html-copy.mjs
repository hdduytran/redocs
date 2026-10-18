// Static HTML adapter (wireframes, mockups, exports from other tools): the spec IS the
// artifact. It must be a complete document that needs no network.

import { copyFileSync, readFileSync } from 'node:fs';
import { scanRemoteResources } from '../../lib/render-redocs-references.mjs';

export async function render({ specFile, outputFile }) {
  const html = readFileSync(specFile, 'utf8');
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    return { ok: false, error: 'spec must be a complete HTML document (<html>...</html>)' };
  }
  const problems = [];
  scanRemoteResources(html, 'spec.html', problems);
  if (/\bfetch\s*\(|XMLHttpRequest/.test(html)) {
    problems.push({ code: 'RD009', line: undefined, message: 'uses fetch()/XMLHttpRequest, which fails over file://' });
  }
  if (problems.length) {
    return { ok: false, error: problems.map((p) => `${p.code}${p.line ? ` line ${p.line}` : ''}: ${p.message}`).join('; ') };
  }
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  copyFileSync(specFile, outputFile);
  return { ok: true, title };
}
