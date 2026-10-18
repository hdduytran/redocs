// `redocs embed <book> <plugin> <artifact-id> --spec <file> [--type ...]`
// Copies the spec into artifacts/<id>/, renders it with the plugin and writes receipt.json
// with the spec hash. A failed render keeps the previous output so the book never loses a
// working diagram; the receipt records the failure and `check` reports it.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBook } from './load-book-from-directory.mjs';
import { loadPlugin } from './load-plugin-registry.mjs';
import { ID_PATTERNS, RedocsError, resolveInside, sha256File, writeJsonFile } from './shared-helpers.mjs';

function outputName(id, manifest) {
  return manifest.output === 'image' ? `${id}.png` : `${id}.html`;
}

export async function embedArtifact({ book: bookDir, plugin, artifactId, spec, options = {}, title, allowBookPlugins = false }) {
  if (!ID_PATTERNS.slug.test(artifactId || '')) throw new RedocsError(`Invalid artifact id '${artifactId}' (lowercase slug)`, { code: 'ERR_REDOCS_ARGS' });
  const book = loadBook(bookDir);
  const { manifest, render } = await loadPlugin(book, plugin, { allowBookPlugins });
  const specSource = path.resolve(spec);
  if (!existsSync(specSource) || !statSync(specSource).isFile()) throw new RedocsError(`Spec file not found: ${specSource}`, { code: 'ERR_REDOCS_ARGS' });
  const extension = manifest.specExtension || '.json';
  if (path.extname(specSource).toLowerCase() !== extension) {
    throw new RedocsError(`Plugin '${plugin}' expects a ${extension} spec, got ${path.basename(specSource)}`, { code: 'ERR_REDOCS_ARGS' });
  }
  const cleanOptions = Object.fromEntries(Object.entries(options).filter(([key, value]) => value !== undefined && (manifest.options || []).includes(key)));

  const dir = resolveInside(path.join(book.root, 'artifacts'), artifactId);
  const specTarget = path.join(dir, `spec${extension}`);
  mkdirSync(dir, { recursive: true });
  if (path.resolve(specTarget) !== specSource) {
    // Only one spec.* may exist per artifact.
    for (const name of readdirSync(dir)) if (name.startsWith('spec.') && name !== `spec${extension}`) unlinkSync(path.join(dir, name));
    copyFileSync(specSource, specTarget);
  }
  const inputHash = sha256File(specTarget);
  const output = outputName(artifactId, manifest);

  const work = mkdtempSync(path.join(process.env.KIROCREW_SCRATCH || tmpdir(), 'redocs-embed-'));
  let result;
  try {
    const tempOutput = path.join(work, output);
    try {
      result = await render({ specFile: specTarget, outputFile: tempOutput, options: cleanOptions, book, plugin: manifest });
    } catch (error) {
      result = { ok: false, error: `plugin crashed: ${error.message}` };
    }
    if (result.ok && !existsSync(tempOutput)) result = { ...result, ok: false, error: 'plugin reported success but wrote no output' };
    if (result.ok) {
      const finalOutput = path.join(dir, output);
      try {
        renameSync(tempOutput, finalOutput);
      } catch {
        copyFileSync(tempOutput, finalOutput); // different filesystem
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // Plugin notices (e.g. "archify update available") are relayed to the caller, not stored:
  // they would change the receipt on every render.
  const { update, ...storedPluginReceipt } = result.pluginReceipt || {};
  const receipt = {
    ok: Boolean(result.ok),
    artifactId,
    plugin,
    ...(result.pluginVersion ? { pluginVersion: result.pluginVersion } : {}),
    options: cleanOptions,
    inputHash,
    output,
    ...(title || result.title ? { title: title || result.title } : {}),
    ...(result.ok ? {} : { error: String(result.error || 'render failed') }),
    ...(result.pluginReceipt ? { pluginReceipt: storedPluginReceipt } : {}),
  };
  writeJsonFile(path.join(dir, 'receipt.json'), receipt);
  return {
    ok: receipt.ok,
    command: 'embed',
    summary: receipt.ok
      ? `OK embed: artifacts/${artifactId}/${output} (${plugin}). Reference it with:\n  \`\`\`redocs-embed\n  {"artifact": "${artifactId}", "caption": "..."}\n  \`\`\`${update ? `\n  note: ${update}` : ''}`
      : `FAILED embed ${artifactId} (${plugin}): ${receipt.error}${existsSync(path.join(dir, output)) ? '\n  The previous output was kept.' : ''}`,
    artifact: artifactId,
    plugin,
    receipt: `artifacts/${artifactId}/receipt.json`,
    error: receipt.error,
    pluginNotice: update,
  };
}

/** Re-render every artifact whose spec changed since its receipt, or whose last render failed. */
export async function refreshStaleArtifacts({ book: bookDir, allowBookPlugins = false }) {
  const book = loadBook(bookDir);
  const results = [];
  for (const artifact of book.artifacts.values()) {
    const spec = artifact.files.find((f) => f.startsWith('spec.'));
    if (!spec || !artifact.receipt) continue;
    const fresh = artifact.receipt.ok && sha256File(path.join(artifact.dir, spec)) === artifact.receipt.inputHash && artifact.files.includes(artifact.receipt.output);
    if (fresh) continue;
    results.push(await embedArtifact({
      book: book.root, plugin: artifact.receipt.plugin, artifactId: artifact.id, spec: path.join(artifact.dir, spec),
      options: artifact.receipt.options || {}, title: artifact.receipt.title, allowBookPlugins,
    }));
  }
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    command: 'embed --refresh-stale',
    summary: `${failed.length ? 'FAILED' : 'OK'} refresh: ${results.length} stale artifact(s) re-rendered, ${failed.length} failed${failed.map((f) => `\n  ${f.summary}`).join('')}`,
    refreshed: results.map((r) => r.artifact),
    failed: failed.map((r) => r.artifact),
  };
}
