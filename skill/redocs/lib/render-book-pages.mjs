// Render every page at every milestone into memory. Both `check` and `build` use this, so
// what check validates is exactly what build writes.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { milestoneOrder, resolveVariant } from './milestone-order-and-lifecycle.mjs';
import { renderHtmlFragment } from './render-html-fragment-with-redocs-extensions.mjs';
import { renderMarkdown } from './render-markdown-with-redocs-extensions.mjs';
import { createRenderContext, renderEntityChip, scanRemoteResources, scanTodoMarkers } from './render-redocs-references.mjs';
import { diagnostic, escapeHtml, toPosix } from './shared-helpers.mjs';
import { relativeHref, SITE } from './site-paths-and-urls.mjs';

/**
 * @typedef {object} RenderedPage
 * @property {string} milestone
 * @property {object} page loader Page
 * @property {{file: string, variant: string|null, inheritedFrom: string|null}|null} resolved
 * @property {string} outFile
 * @property {string} bodyHtml
 * @property {Array<{level:number,text:string,id:string}>} headings
 * @property {object} ctx render context (links, entityRefs, embeds, assets)
 * @property {{from: string, to: string}|null} standalone copy job for standalone HTML pages
 */

export function renderedKey(milestone, pageId) {
  return `${milestone}|${pageId}`;
}

function dedupe(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((d) => {
    const key = `${d.code}|${d.file}|${d.line}|${d.pointer}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @returns {{pages: Map<string, RenderedPage>, diagnostics: object[]}} */
export function renderBookPages(book) {
  const order = milestoneOrder(book.milestones);
  const pages = new Map();
  const diagnostics = [];
  const scannedSources = new Set();

  for (const milestone of book.milestones.map((m) => m.id)) {
    for (const page of book.pages.values()) {
      const outFile = SITE.pageOut(milestone, page.id);
      const resolved = resolveVariant(page, milestone, book.milestones);
      const sourceFile = resolved ? toPosix(path.relative(book.root, path.join(page.dir, resolved.file))) : page.metaFile;
      const ctx = createRenderContext({ book, milestone, order, outFile, sourceFile, variantSpecific: Boolean(resolved?.variant) });
      let bodyHtml;
      let headings = [];
      let standalone = null;

      if (!resolved) {
        const first = Object.keys(page.variants)[0];
        bodyHtml = `<h1>${escapeHtml(page.meta.title)}</h1>\n<p class="rd-absent">This page does not exist yet at this milestone. It starts at <strong>${escapeHtml(first)}</strong>.</p>`;
      } else {
        const absolute = path.join(page.dir, resolved.file);
        if (!existsSync(absolute)) {
          ctx.diagnostics.push(diagnostic('RD006', 'error', `Source file missing: ${sourceFile}`, { file: page.metaFile, hint: 'Create the file or fix "entry"/"variants" in page.json.' }));
          bodyHtml = `<h1>${escapeHtml(page.meta.title)}</h1>\n<p class="rd-absent">Source file missing.</p>`;
        } else {
          const source = readFileSync(absolute, 'utf8');
          if (!scannedSources.has(sourceFile)) {
            scannedSources.add(sourceFile);
            scanTodoMarkers(source, sourceFile, ctx.diagnostics);
            scanRemoteResources(source, sourceFile, ctx.diagnostics);
          }
          if (resolved.file.endsWith('.md')) {
            ({ html: bodyHtml, headings } = renderMarkdown(source, ctx));
          } else if (page.meta.standalone) {
            const to = SITE.standaloneOut(milestone, page.id);
            standalone = { from: absolute, to };
            bodyHtml = `<h1 class="rd-visually-hidden">${escapeHtml(page.meta.title)}</h1>\n<figure class="rd-embed rd-embed--page"><iframe class="rd-embed__frame" src="${relativeHref(outFile, to)}" title="${escapeHtml(page.meta.title)}" height="900" data-max-height="4000"></iframe><a class="rd-embed__open" href="${relativeHref(outFile, to)}" target="_blank" rel="noopener">Open full screen</a></figure>`;
          } else {
            ({ html: bodyHtml, headings } = renderHtmlFragment(source, ctx));
          }
        }
      }

      // Entities declared in page.json are validated like inline references.
      const declared = (page.meta.entities || []).map((id) => renderEntityChip({ ...ctx, sourceFile: page.metaFile }, id, undefined, undefined));
      ctx.declaredEntitiesHtml = declared;
      diagnostics.push(...ctx.diagnostics);
      pages.set(renderedKey(milestone, page.id), { milestone, page, resolved, outFile, bodyHtml, headings, ctx, standalone });
    }
  }
  return { pages, diagnostics: dedupe(diagnostics) };
}
