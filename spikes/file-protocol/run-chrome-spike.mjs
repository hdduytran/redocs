// Runs the file:// spike pages in headless Chrome and prints the behaviour matrix as JSON.
// Usage: node spikes/file-protocol/run-chrome-spike.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFilePages } from '../../skill/redocs/lib/chrome-cdp-file-protocol-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = ['index.html', 'sub/page.html', 'redirect.html'].map((f) => path.join(here, f));

const report = await checkFilePages(files, {
  settleMs: 6000, // index waits 5s before declaring postMessage failure
  evaluate: '({ spike: window.__SPIKE || null, location: location.pathname, iframeHeight: document.getElementById("art")?.style.height || null })',
});
console.log(JSON.stringify(report, null, 2));
