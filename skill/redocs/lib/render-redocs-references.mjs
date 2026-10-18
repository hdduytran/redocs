// Pieces shared by the Markdown and HTML-fragment renderers: reference resolution
// (page:, asset:), entity chips, artifact embeds and the offline-resource scan.
//
// A render context collects everything `check` needs instead of throwing:
//   ctx = { book, milestone, order, outFile, sourceFile, variantSpecific,
//           diagnostics: [], links: [], entityRefs: [], embeds: [], assets: [] }

import { existsSync } from 'node:fs';
import path from 'node:path';
import { isAlive } from './milestone-order-and-lifecycle.mjs';
import { diagnostic, escapeHtml, resolveInside } from './shared-helpers.mjs';
import { entityAnchor, relativeHref, SITE } from './site-paths-and-urls.mjs';

export function createRenderContext({ book, milestone, order, outFile, sourceFile, variantSpecific }) {
  return { book, milestone, order, outFile, sourceFile, variantSpecific, diagnostics: [], links: [], entityRefs: [], embeds: [], assets: [] };
}

/**
 * Turn a `page:`/`asset:` reference into a relative href. Other URLs pass through.
 * Page targets are validated later (anchors need every page rendered), so they are only recorded.
 */
export function resolveReference(ctx, raw, line) {
  if (raw.startsWith('page:')) {
    const [target, anchor = ''] = raw.slice(5).split('#');
    ctx.links.push({ target, anchor, line, file: ctx.sourceFile });
    return relativeHref(ctx.outFile, SITE.pageOut(ctx.milestone, target), anchor);
  }
  if (raw.startsWith('asset:')) {
    const assetPath = raw.slice(6);
    let exists = false;
    try {
      exists = existsSync(resolveInside(path.join(ctx.book.root, 'assets'), assetPath));
    } catch {
      exists = false;
    }
    if (!exists) {
      ctx.diagnostics.push(diagnostic('RD008', 'error', `Asset not found: assets/${assetPath}`, { file: ctx.sourceFile, line, hint: 'Put the file under assets/ or fix the path.' }));
    }
    ctx.assets.push(assetPath);
    return relativeHref(ctx.outFile, SITE.assetOut(assetPath));
  }
  return raw;
}

/** Lifecycle label of an entity at the context milestone. */
function lifecycleAt(ctx, entity) {
  if (isAlive(entity, ctx.milestone, ctx.order)) return null;
  const at = ctx.order.get(ctx.milestone);
  if (entity.since && ctx.order.get(entity.since) > at) return { cls: 'planned', text: `from ${entity.since}` };
  return { cls: 'removed', text: entity.replaced_by ? `replaced by ${entity.replaced_by}` : `removed in ${entity.until}` };
}

/** `[[svc:billing]]` / `[[svc:billing|the billing service]]` -> chip linking to the catalog. */
export function renderEntityChip(ctx, id, label, line) {
  const entity = ctx.book.entities.get(id);
  ctx.entityRefs.push({ id, line, file: ctx.sourceFile });
  if (!entity) {
    ctx.diagnostics.push(diagnostic('RD004', 'error', `Unknown entity '${id}'`, { file: ctx.sourceFile, line, hint: `Add it with: redocs add-entity <book> ${id} --type <type> --name "..."` }));
    return `<span class="rd-entity rd-entity--missing" title="Unknown entity">${escapeHtml(label || id)}</span>`;
  }
  const state = lifecycleAt(ctx, entity);
  if (state && ctx.variantSpecific) {
    ctx.diagnostics.push(diagnostic('RD005', 'error', `Entity '${id}' does not exist at milestone '${ctx.milestone}' (${state.text})`, {
      file: ctx.sourceFile, line, hint: 'Fix the entity since/until in entities/, or describe it on the variant of the right milestone.',
    }));
  }
  const href = relativeHref(ctx.outFile, SITE.catalogTypeOut(ctx.milestone, entity.type), entityAnchor(id));
  const badge = state ? ` <span class="rd-badge rd-badge--${state.cls}">${escapeHtml(state.text)}</span>` : '';
  return `<a class="rd-entity rd-entity--${escapeHtml(entity.type)}" href="${href}" title="${escapeHtml(entity.summary || entity.name)}">${escapeHtml(label || entity.name)}</a>${badge}`;
}

/** Artifact embed: iframe for HTML artifacts, img for image artifacts, always with an "open" link. */
export function renderEmbed(ctx, spec, line) {
  const id = spec?.artifact;
  ctx.embeds.push({ id, line, file: ctx.sourceFile });
  const artifact = id ? ctx.book.artifacts.get(id) : null;
  if (!artifact || !artifact.receipt) {
    ctx.diagnostics.push(diagnostic('RD007', 'error', id ? `Artifact '${id}' not found or has no receipt.json` : 'Embed block needs an "artifact" id', {
      file: ctx.sourceFile, line, hint: id ? `Create it with: redocs embed <book> <plugin> ${id} --spec <file>` : 'Example: {"artifact": "system-context", "height": 640}',
    }));
    return `<div class="rd-embed rd-embed--missing" role="note">Missing artifact: ${escapeHtml(id || '(none)')}</div>`;
  }
  const output = artifact.receipt.output;
  const href = relativeHref(ctx.outFile, SITE.artifactOut(id, output));
  const title = spec.title || artifact.receipt.title || id;
  const caption = spec.caption ? `<figcaption>${escapeHtml(spec.caption)}</figcaption>` : '';
  const open = `<a class="rd-embed__open" href="${href}" target="_blank" rel="noopener">Open full screen</a>`;
  if (/\.(png|jpe?g|webp|svg)$/i.test(output)) {
    return `<figure class="rd-embed rd-embed--image"><img src="${href}" alt="${escapeHtml(spec.alt || title)}" loading="lazy">${caption}${open}</figure>`;
  }
  const height = Number.isFinite(spec.height) ? Math.max(200, Math.min(2000, Math.round(spec.height))) : 640;
  return `<figure class="rd-embed"><iframe class="rd-embed__frame" src="${href}" title="${escapeHtml(title)}" height="${height}" data-max-height="${height}" loading="lazy"></iframe>${caption}${open}</figure>`;
}

const REMOTE_RESOURCE = /<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*?\s(src|href|data)\s*=\s*["']?(https?:)?\/\//gi;

/** RD009: resources that would need the network. Plain <a href> links are allowed. */
export function scanRemoteResources(html, file, diagnostics) {
  for (const match of html.matchAll(REMOTE_RESOURCE)) {
    const line = html.slice(0, match.index).split('\n').length;
    diagnostics.push(diagnostic('RD009', 'error', `<${match[1]}> loads a remote resource; the book must work offline over file://`, {
      file, line, hint: 'Download the file into assets/ and reference it with asset:...',
    }));
  }
}

/** RD011 (warning): unresolved TODO(owner) markers, so the owner sees what is left to answer. */
export function scanTodoMarkers(source, file, diagnostics) {
  const lines = source.split('\n');
  lines.forEach((text, index) => {
    if (/TODO\(owner\)/.test(text)) {
      diagnostics.push(diagnostic('RD011', 'warning', `Open question for the owner: ${text.replace(/^[>\s-]*/, '').slice(0, 120)}`, { file, line: index + 1 }));
    }
  });
}
