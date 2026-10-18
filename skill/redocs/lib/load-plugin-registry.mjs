// Plugin discovery. Built-in plugins live in <skill>/plugins/<name>/plugin.json. A book may
// declare more in book.json ("plugins": {"<name>": {"manifest": "tools/x/plugin.json"}}); those
// run code from the book repository, so they need --allow-book-plugins.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RedocsError, resolveInside } from './shared-helpers.mjs';
import { validateAgainstSchema } from './validate-book-schemas.mjs';

const builtinRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

function readManifest(file, origin) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const problems = validateAgainstSchema('plugin', manifest, file);
  if (problems.length) {
    throw new RedocsError(`Invalid plugin manifest ${file}: ${problems.map((p) => `${p.pointer} ${p.message}`).join('; ')}`, { code: 'ERR_REDOCS_PLUGIN' });
  }
  return { ...manifest, dir: path.dirname(file), origin };
}

export function listPlugins(book) {
  const plugins = new Map();
  for (const name of readdirSync(builtinRoot).sort()) {
    const file = path.join(builtinRoot, name, 'plugin.json');
    if (existsSync(file)) plugins.set(name, readManifest(file, 'builtin'));
  }
  for (const [name, settings] of Object.entries(book?.config?.plugins || {})) {
    if (!settings?.manifest || plugins.has(name)) continue;
    plugins.set(name, readManifest(resolveInside(book.root, settings.manifest), 'book'));
  }
  return plugins;
}

/** @returns {Promise<{manifest: object, render: Function}>} */
export async function loadPlugin(book, name, { allowBookPlugins = false } = {}) {
  const plugins = listPlugins(book);
  const manifest = plugins.get(name);
  if (!manifest) {
    throw new RedocsError(`Unknown plugin '${name}'. Available: ${[...plugins.keys()].join(', ')}`, { code: 'ERR_REDOCS_ARGS' });
  }
  if (manifest.origin === 'book' && !allowBookPlugins) {
    throw new RedocsError(`Plugin '${name}' is defined by this book and would run its code`, {
      code: 'ERR_REDOCS_PLUGIN', hint: 'Review the plugin, then pass --allow-book-plugins.',
    });
  }
  const module = await import(pathToFileURL(path.join(manifest.dir, manifest.adapter)).href);
  if (typeof module.render !== 'function') throw new RedocsError(`Plugin '${name}' adapter has no render()`, { code: 'ERR_REDOCS_PLUGIN' });
  return { manifest, render: module.render };
}
