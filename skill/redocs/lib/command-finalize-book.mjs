// `redocs finalize <book>`: check -> build -> file:// browser check. The receipt is the only
// evidence an agent may use to claim the book is done. When book.json sets "publish": {"dir": ...},
// a successful finalize also copies dist/ into that committed folder so the built site travels with
// the repo (no hand-run rsync). The copy happens AFTER the browser check, which runs on dist/, so
// the publish folder is the only thing ever wiped.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkFilePages } from './chrome-cdp-file-protocol-check.mjs';
import { buildBook } from './command-build-book-site.mjs';
import { checkBookModel } from './command-check-book.mjs';
import { publishDir, syncPublishDir } from './publish-site.mjs';
import { REDOCS_VERSION } from './redocs-version.mjs';
import { toPosix } from './shared-helpers.mjs';

const MAX_REPORTED = 20;

export async function finalizeBook({ book: bookDir, strict = false, skipBrowser = false, allowSkipBrowser = false }) {
  const receipt = { ok: false, command: 'finalize', redocsVersion: REDOCS_VERSION, checks: null, build: null, browser: null, publish: null };
  const check = checkBookModel(bookDir, { strict });
  receipt.checks = { ok: check.ok, errors: check.errors, warnings: check.warnings };
  // Published copy, when the browser check passes. Done inside finish() so the written receipt
  // (which records the publish result) is itself part of what gets copied into publish.dir.
  const publish = () => {
    const rel = publishDir(check.book?.config);
    if (!rel || !receipt.ok || !receipt.build) return;
    const files = syncPublishDir(check.book.root, rel, path.join(check.book.root, 'dist'));
    receipt.publish = { dir: rel, files };
  };
  const finish = (summary) => {
    if (receipt.build) {
      const distAbs = path.join(check.book.root, 'dist');
      writeFileSync(path.join(distAbs, 'finalize-receipt.json'), `${JSON.stringify({ ...receipt, diagnostics: undefined }, null, 2)}\n`);
      publish();
    }
    const publishNote = receipt.publish ? `\n  published: copied dist/ -> ${receipt.publish.dir}/ (${receipt.publish.files} files)` : '';
    return { ...receipt, summary: summary + publishNote, diagnostics: check.diagnostics };
  };
  if (!check.ok) {
    return finish(`FAILED finalize at check: ${check.errors} error(s), ${check.warnings} warning(s)${strict ? ' [strict]' : ''}. Fix them and rerun.`);
  }

  const build = buildBook({ book: check.book, rendered: check.render });
  // dist is recorded book-relative so the receipt carries no absolute machine path (safe to pack).
  receipt.build = { dist: toPosix(path.relative(check.book.root, build.dist)), milestones: build.milestones, pages: build.pages, distHash: build.distHash, sourceHash: build.sourceHash };

  if (skipBrowser) {
    receipt.browser = { status: 'skipped' };
    receipt.ok = Boolean(allowSkipBrowser);
    return finish(`${receipt.ok ? 'OK' : 'FAILED'} finalize: browser check skipped${allowSkipBrowser ? ' (allowed)' : '; pass --allow-skip-browser to accept that'}. ${build.pages} pages built.`);
  }

  let report;
  try {
    report = await checkFilePages(build.htmlFiles.map((f) => path.join(build.dist, f)), { settleMs: 150 });
  } catch (error) {
    receipt.browser = { status: 'unavailable', error: error.message };
    return finish(`FAILED finalize: browser check could not run: ${error.message}`);
  }
  const problems = report.pages.filter((p) => p.error || p.consoleErrors.length || p.failedRequests.length);
  receipt.browser = {
    status: problems.length ? 'failed' : 'passed',
    chrome: report.chrome,
    pages: report.pages.length,
    consoleErrors: report.pages.reduce((n, p) => n + p.consoleErrors.length, 0),
    failedRequests: report.pages.reduce((n, p) => n + p.failedRequests.length, 0),
    pageErrors: report.pages.filter((p) => p.error).length,
    problems: problems.slice(0, MAX_REPORTED).map((p) => ({
      page: path.relative(build.dist, p.file), error: p.error, consoleErrors: p.consoleErrors.slice(0, 5), failedRequests: p.failedRequests.slice(0, 5),
    })),
  };
  receipt.ok = problems.length === 0;
  return finish(receipt.ok
    ? `OK finalize: ${check.errors} errors, ${check.warnings} warnings; ${build.pages} pages over ${build.milestones.length} milestone(s); browser ${report.pages.length} pages, 0 console errors.\n  open: ${path.join(build.dist, 'index.html')}`
    : `FAILED finalize at browser check: ${problems.length} page(s) with errors (see browser.problems in --json).`);
}
