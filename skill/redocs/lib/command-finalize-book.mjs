// `redocs finalize <book>`: check -> build -> file:// browser check. The receipt is the only
// evidence an agent may use to claim the book is done.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkFilePages } from './chrome-cdp-file-protocol-check.mjs';
import { buildBook } from './command-build-book-site.mjs';
import { checkBookModel } from './command-check-book.mjs';
import { REDOCS_VERSION } from './redocs-version.mjs';

const MAX_REPORTED = 20;

export async function finalizeBook({ book: bookDir, strict = false, skipBrowser = false, allowSkipBrowser = false }) {
  const receipt = { ok: false, command: 'finalize', redocsVersion: REDOCS_VERSION, checks: null, build: null, browser: null };
  const check = checkBookModel(bookDir, { strict });
  receipt.checks = { ok: check.ok, errors: check.errors, warnings: check.warnings };
  const finish = (summary) => {
    if (receipt.build) writeFileSync(path.join(receipt.build.dist, 'finalize-receipt.json'), `${JSON.stringify({ ...receipt, diagnostics: undefined }, null, 2)}\n`);
    return { ...receipt, summary, diagnostics: check.diagnostics };
  };
  if (!check.ok) {
    return finish(`FAILED finalize at check: ${check.errors} error(s), ${check.warnings} warning(s)${strict ? ' [strict]' : ''}. Fix them and rerun.`);
  }

  const build = buildBook({ book: check.book, rendered: check.render });
  receipt.build = { dist: build.dist, milestones: build.milestones, pages: build.pages, distHash: build.distHash };

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
