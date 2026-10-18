// Dev helper: screenshot built pages for visual review.
// Usage: node skill/redocs/scripts/screenshot-pages.mjs <out-dir> [--dark] [--width 1280] <page.html>...
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { checkFilePages } from '../lib/chrome-cdp-file-protocol-check.mjs';

const args = process.argv.slice(2);
const dark = args.includes('--dark');
const widthAt = args.indexOf('--width');
const width = widthAt >= 0 ? Number(args[widthAt + 1]) : 1280;
const rest = args.filter((a, i) => a !== '--dark' && (widthAt < 0 || (i !== widthAt && i !== widthAt + 1)));
const [outDir, ...files] = rest;
mkdirSync(outDir, { recursive: true });
const report = await checkFilePages(files.map((f) => path.resolve(f)), {
  settleMs: 1200,
  viewport: { width, height: 900, dark },
  screenshot: (file) => path.join(outDir, `${path.relative(process.cwd(), file).replace(/[\\/]/g, '__')}${dark ? '.dark' : ''}.png`),
});
for (const page of report.pages) console.log(`${page.screenshot} errors=${page.consoleErrors.length + page.failedRequests.length}${page.error ? ` ${page.error}` : ''}`);
