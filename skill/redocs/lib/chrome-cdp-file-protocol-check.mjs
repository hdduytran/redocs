// Headless Chrome checker for pages opened through file://.
//
// Talks to Chrome over --remote-debugging-pipe (fd 3 = commands in, fd 4 = events out,
// NUL-delimited JSON), the same transport archify uses, so no port or WebSocket is needed.
// The browser runs with a throwaway profile and WITHOUT any flag that relaxes file://
// security: the check must see exactly what a reader double-clicking index.html sees.

import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHROME_ENV = 'REDOCS_CHROME';
export const NO_SANDBOX_ENV = 'REDOCS_CHROME_NO_SANDBOX';
const DEFAULT_PAGE_TIMEOUT_MS = 15000;
const STARTUP_TIMEOUT_MS = 60000;

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a Chrome/Chromium executable: $REDOCS_CHROME first, then well-known paths and PATH. */
export function findChrome({ env = process.env, platform = process.platform } = {}) {
  if (env[CHROME_ENV]) return isExecutable(env[CHROME_ENV]) ? env[CHROME_ENV] : null;
  const fixed = platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : [];
  for (const candidate of fixed) if (isExecutable(candidate)) return candidate;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** Minimal CDP client over the debugging pipe, with flattened target sessions. */
class CdpPipe {
  constructor(writable, readable) {
    this.writable = writable;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    let buffer = '';
    readable.setEncoding('utf8');
    readable.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\0')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (raw) this.#dispatch(JSON.parse(raw));
      }
    });
  }

  #dispatch(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId) {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writable.write(`${JSON.stringify(payload)}\0`);
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  failAll(error) {
    // Later sends must fail fast instead of waiting on a pipe nobody will answer.
    this.closedError = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open each HTML file through file:// and collect console errors, uncaught exceptions and
 * failed resource loads. `evaluate` (optional) is a JS expression whose JSON value is
 * returned per page after `settleMs`. `next` ({file, evaluate}) then navigates the same tab to a
 * second file and returns that evaluation as `nextValue`.
 *
 * @param {string[]} files absolute paths of HTML files
 * @param {{chromePath?: string, settleMs?: number, pageTimeoutMs?: number, evaluate?: string,
 *          next?: {file: string, evaluate?: string},
 *          ignoreFailedUrl?: (url: string) => boolean, screenshot?: (file: string) => string,
 *          viewport?: {width?: number, height?: number, dark?: boolean}}} options
 * @returns {Promise<{chrome: string, pages: Array<{file: string, url: string, consoleErrors: string[],
 *          failedRequests: string[], value?: unknown, error?: string}>}>}
 */
export async function checkFilePages(files, options = {}) {
  const chromePath = options.chromePath || findChrome();
  if (!chromePath) {
    const error = new Error(`Chrome or Chromium not found. Set ${CHROME_ENV} to its executable path.`);
    error.code = 'ERR_REDOCS_NO_CHROME';
    throw error;
  }
  const settleMs = options.settleMs ?? 300;
  const pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const ignoreFailedUrl = options.ignoreFailedUrl || (() => false);

  // Profile dir carries a recognisable marker so leaked processes are easy to find.
  const profileRoot = mkdtempSync(path.join(process.env.KIROCREW_SCRATCH || tmpdir(), 'redocs-cdp-'));
  const args = [
    '--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-sync', '--hide-scrollbars', `--user-data-dir=${profileRoot}`,
    'about:blank',
  ];
  // Chrome's own sandbox cannot start inside some already-sandboxed agent shells; allow an
  // explicit opt-out (same idea as archify's ARCHIFY_CHROME_NO_SANDBOX). This does not touch
  // file:// policy, so what the page can load is unchanged.
  const rootUser = typeof process.getuid === 'function' && process.getuid() === 0;
  if (rootUser || process.env[NO_SANDBOX_ENV] === '1') args.unshift('--no-sandbox');

  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const stderrTail = [];
  child.stderr.on('data', (chunk) => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 20) stderrTail.shift();
  });
  const cdp = new CdpPipe(child.stdio[3], child.stdio[4]);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.once('exit', () => cdp.failAll(new Error(`Chrome exited early: ${stderrTail.join('').slice(-500)}`)));

  const pages = [];
  try {
    await withTimeout(cdp.send('Browser.getVersion'), STARTUP_TIMEOUT_MS, 'Chrome startup');
    for (const file of files) {
      pages.push(await checkOnePage(cdp, file, {
        settleMs, pageTimeoutMs, evaluate: options.evaluate, next: options.next, ignoreFailedUrl,
        screenshot: options.screenshot, viewport: { width: 1280, height: 900, ...options.viewport },
      }));
    }
  } finally {
    try {
      await withTimeout(cdp.send('Browser.close'), 5000, 'Browser.close');
    } catch {
      child.kill('SIGTERM');
    }
    await withTimeout(exited, 10000, 'Chrome exit').catch(() => child.kill('SIGKILL'));
    rmSync(profileRoot, { recursive: true, force: true });
  }
  return { chrome: chromePath, pages };
}

async function checkOnePage(cdp, file, { settleMs, pageTimeoutMs, evaluate, next, ignoreFailedUrl, screenshot, viewport }) {
  const url = pathToFileURL(file).href;
  const result = { file, url, consoleErrors: [], failedRequests: [] };
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const requestUrls = new Map();
  let loaded;
  const loadedPromise = new Promise((resolve) => { loaded = resolve; });

  const off = cdp.onEvent((message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      result.consoleErrors.push(details.exception?.description || details.text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      result.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      result.consoleErrors.push(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
    } else if (method === 'Network.requestWillBeSent') {
      requestUrls.set(params.requestId, params.request.url);
    } else if (method === 'Network.loadingFailed' && !params.canceled) {
      const failedUrl = requestUrls.get(params.requestId) || params.requestId;
      if (!ignoreFailedUrl(failedUrl)) result.failedRequests.push(`${failedUrl}: ${params.errorText}`);
    } else if (method === 'Page.loadEventFired') {
      loaded();
    }
  });

  try {
    await Promise.all([
      cdp.send('Page.enable', {}, sessionId),
      cdp.send('Runtime.enable', {}, sessionId),
      cdp.send('Log.enable', {}, sessionId),
      cdp.send('Network.enable', {}, sessionId),
      cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false }, sessionId),
      ...(viewport.dark ? [cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId)] : []),
    ]);
    const navigation = await cdp.send('Page.navigate', { url }, sessionId);
    if (navigation.errorText) throw new Error(`navigation failed: ${navigation.errorText}`);
    await withTimeout(loadedPromise, pageTimeoutMs, `load ${file}`);
    await delay(settleMs);
    if (evaluate) {
      const response = await cdp.send('Runtime.evaluate', { expression: evaluate, returnByValue: true, awaitPromise: true }, sessionId);
      result.value = response.exceptionDetails ? { error: response.exceptionDetails.text } : response.result?.value;
    }
    if (next) {
      // A second page in the SAME tab (sessionStorage, history survive), e.g. "reader clicks a link".
      const nextLoaded = new Promise((resolve) => { loaded = resolve; });
      const second = await cdp.send('Page.navigate', { url: pathToFileURL(next.file).href }, sessionId);
      if (second.errorText) throw new Error(`navigation failed: ${second.errorText}`);
      await withTimeout(nextLoaded, pageTimeoutMs, `load ${next.file}`);
      await delay(settleMs);
      if (next.evaluate) {
        const response = await cdp.send('Runtime.evaluate', { expression: next.evaluate, returnByValue: true, awaitPromise: true }, sessionId);
        result.nextValue = response.exceptionDetails ? { error: response.exceptionDetails.text } : response.result?.value;
      }
    }
    if (screenshot) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      result.screenshot = screenshot(file);
      writeFileSync(result.screenshot, Buffer.from(data, 'base64'));
    }
  } catch (error) {
    result.error = error.message;
  } finally {
    off();
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
  return result;
}
