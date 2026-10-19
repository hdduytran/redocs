// `redocs build <book>`: render every milestone into dist/ (see site-paths-and-urls.mjs).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildCatalogPages, buildChangesPages, buildComparePages, buildHomePage } from './build-generated-pages.mjs';
import { agentIndexScript, buildAgentIndexes } from './build-agent-index.mjs';
import { loadBook } from './load-book-from-directory.mjs';
import { comparisonPairs, currentMilestone, resolveVariant } from './milestone-order-and-lifecycle.mjs';
import { renderBookPages, renderedKey } from './render-book-pages.mjs';
import { renderShell } from './render-page-shell-layout.mjs';
import { escapeHtml, RedocsError, resolveInside, sha256Text, toPosix } from './shared-helpers.mjs';
import { relativeHref, SITE } from './site-paths-and-urls.mjs';

const themeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'theme');
const SEARCH_TEXT_LIMIT = 20000;
// Chat answers are Markdown from the model; the panel renders them with the same parser the book
// uses, shipped as markdown-it's own browser UMD build (a classic script, so it loads over file://).
const vendorScripts = {
  'markdown-it.min.js': () => path.join(path.dirname(createRequire(import.meta.url).resolve('markdown-it')), 'browser', 'markdown-it.umd.min.js'),
};
const chatScriptSource = (file) => { const name = path.basename(file); return vendorScripts[name] ? vendorScripts[name]() : path.join(themeDir, name); };

/** Injected into every iframed HTML file so the parent can size the frame (verified in spikes/file-protocol). */
export const RESIZE_SCRIPT = `<script data-redocs-resize>(function(){function s(){var b=document.body,d=document.documentElement;var h=b?Math.max(b.scrollHeight,b.offsetHeight+16):d.scrollHeight;try{parent.postMessage({type:'redocs:height',h:Math.ceil(h)},'*')}catch(e){}}if(window.ResizeObserver){new ResizeObserver(s).observe(document.body||document.documentElement)}addEventListener('load',s);s()})();</script>`;

export function injectResizeScript(html) {
  if (html.includes('data-redocs-resize')) return html;
  const index = html.lastIndexOf('</body>');
  return index >= 0 ? html.slice(0, index) + RESIZE_SCRIPT + html.slice(index) : html + RESIZE_SCRIPT;
}

function plainText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageFooter(book, r) {
  const meta = r.page.meta;
  const rows = [];
  if (meta.owner) rows.push(`<dt>Owner</dt><dd>${escapeHtml(meta.owner)}</dd>`);
  if (meta.status) rows.push(`<dt>Status</dt><dd>${escapeHtml(meta.status)}</dd>`);
  if (meta.updated) rows.push(`<dt>Updated</dt><dd>${escapeHtml(meta.updated)}</dd>`);
  if (r.ctx.declaredEntitiesHtml?.length) rows.push(`<dt>Entities</dt><dd>${r.ctx.declaredEntitiesHtml.join(' ')}</dd>`);
  if (meta.sources?.length) rows.push(`<dt>Sources</dt><dd><ul>${meta.sources.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></dd>`);
  return rows.length ? `<dl class="rd-meta">${rows.join('')}</dl>` : '';
}

function pageNotices(book, r) {
  const notices = [];
  if (r.resolved?.inheritedFrom) {
    notices.push(`This page has no specific content for <strong>${escapeHtml(r.milestone)}</strong>; showing the <strong>${escapeHtml(r.resolved.inheritedFrom)}</strong> version.`);
  }
  if (r.page.variants) {
    const compares = comparisonPairs(book.milestones)
      .filter(([from, to]) => (to === r.milestone || from === r.milestone)
        && resolveVariant(r.page, from, book.milestones)?.file !== resolveVariant(r.page, to, book.milestones)?.file)
      .map(([from, to]) => `<a href="${relativeHref(r.outFile, SITE.compareOut(to, r.page.id, from))}">${escapeHtml(from)} ↔ ${escapeHtml(to)}</a>`);
    if (compares.length) notices.push(`<span class="rd-notice__compare">Compare milestones: ${compares.join(' · ')}</span>`);
  }
  return notices;
}

function writeOut(dist, relative, content, written) {
  const file = path.join(dist, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  written.push(relative);
}

function copyTree(from, to, rel, written) {
  if (!existsSync(from)) return;
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = path.join(from, name);
    if (statSync(source).isDirectory()) copyTree(source, path.join(to, name), `${rel}/${name}`, written);
    else {
      mkdirSync(to, { recursive: true });
      copyFileSync(source, path.join(to, name));
      written.push(`${rel}/${name}`);
    }
  }
}

/** Deterministic hash over relative paths + bytes of every file in dist/. */
export function hashDirectory(dir) {
  const files = [];
  (function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  })(dir);
  const parts = files.map((f) => `${toPosix(path.relative(dir, f))}\0${sha256Text(readFileSync(f))}`);
  return `sha256:${sha256Text(parts.join('\n'))}`;
}

/**
 * Render and write the site. Content problems do not stop the build (check reports them);
 * a missing book or an unusable output path does.
 * @param {{book: string|object, out?: string, rendered?: object}} o
 */
export function buildBook(o) {
  const book = typeof o.book === 'string' ? loadBook(o.book) : o.book;
  if (!book.config) throw new RedocsError('book.json is unreadable; run `redocs check` for details', { code: 'ERR_REDOCS_BOOK_JSON', diagnostics: book.diagnostics });
  const dist = o.out ? path.resolve(o.out) : resolveInside(book.root, 'dist');
  if (dist === book.root || book.root.startsWith(dist + path.sep)) throw new RedocsError(`Refusing to build into ${dist}: it contains the book sources`, { code: 'ERR_REDOCS_PATH' });
  const { pages: rendered, diagnostics } = o.rendered || renderBookPages(book);

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const written = [];

  for (const name of ['redocs.css', 'redocs.js']) writeOut(dist, `_redocs/${name}`, readFileSync(path.join(themeDir, name)), written);
  // Opt-in Ask AI panel: the query engine, the tool loop and the UI, plus one agent index per milestone.
  const chat = book.config.chat?.enabled === true;
  const agentIndexes = chat ? buildAgentIndexes(book, rendered) : null;
  if (chat) for (const file of SITE.chatScripts) writeOut(dist, file, readFileSync(chatScriptSource(file)), written);
  copyTree(path.join(book.root, 'assets'), path.join(dist, 'assets'), 'assets', written);

  for (const artifact of book.artifacts.values()) {
    const output = artifact.receipt?.output;
    if (!output || !artifact.files.includes(output)) continue;
    const source = path.join(artifact.dir, output);
    const target = SITE.artifactOut(artifact.id, output);
    if (output.endsWith('.html')) writeOut(dist, target, injectResizeScript(readFileSync(source, 'utf8')), written);
    else writeOut(dist, target, readFileSync(source), written);
  }

  const current = currentMilestone(book.milestones).id;
  writeOut(dist, 'index.html', `<!doctype html>
<html lang="${escapeHtml(book.config.language || 'en')}"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${SITE.homeOut(current)}">
<title>${escapeHtml(book.config.title)}</title></head>
<body><p>Open <a href="${SITE.homeOut(current)}">${escapeHtml(book.config.title)} (${escapeHtml(current)})</a>.</p></body></html>
`, written);

  let pageCount = 0;
  for (const milestone of book.milestones.map((m) => m.id)) {
    const search = [];
    for (const page of book.pages.values()) {
      const r = rendered.get(renderedKey(milestone, page.id));
      const switchTargets = Object.fromEntries(book.milestones.map((m) => [m.id, SITE.pageOut(m.id, page.id)]));
      const html = renderShell({
        book, milestone, outFile: r.outFile, title: page.meta.title, bodyHtml: r.bodyHtml, headings: r.headings,
        switchTargets, notices: pageNotices(book, r), footerHtml: pageFooter(book, r), kind: page.meta.kind,
        copyMeta: {
          pageRef: `page:${page.id}`,
          title: page.meta.title,
          milestone,
          kind: page.meta.kind,
          entities: page.meta.entities || [],
          bookTitle: book.config.title,
        },
        sourceText: r.rawSource,
        sourceFormat: r.sourceFormat,
        comments: book.comments.get(page.id) || [],
      });
      writeOut(dist, r.outFile, html, written);
      pageCount += 1;
      if (r.standalone) writeOut(dist, r.standalone.to, injectResizeScript(readFileSync(r.standalone.from, 'utf8')), written);
      search.push({
        t: page.meta.title,
        u: `${page.id}.html`,
        k: page.meta.kind,
        h: r.headings.filter((h) => h.level <= 3).map((h) => h.text),
        x: plainText(r.bodyHtml).slice(0, SEARCH_TEXT_LIMIT),
      });
    }
    for (const entity of [...book.entities.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      search.push({ t: entity.name, u: `catalog/${entity.type}.html#${entity.id.replace(':', '-')}`, k: entity.type, h: [entity.id], x: entity.summary || '' });
    }

    const generated = [
      buildHomePage(book, milestone),
      ...buildCatalogPages(book, milestone),
      ...buildChangesPages(book, milestone),
      ...buildComparePages(book, milestone, rendered),
    ];
    for (const g of generated) writeOut(dist, g.outFile, g.html, written);
    pageCount += generated.length;
    writeOut(dist, SITE.searchOut(milestone), `window.__REDOCS_SEARCH=${JSON.stringify(search)};\n`, written);
    if (chat) writeOut(dist, SITE.agentIndexOut(milestone), agentIndexScript(agentIndexes.get(milestone)), written);
  }

  const htmlFiles = written.filter((f) => f.endsWith('.html') && !f.startsWith('artifacts/') && !f.startsWith('assets/')).sort();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const distHash = hashDirectory(dist);
  return {
    ok: true,
    command: 'build',
    summary: `OK build: ${pageCount} pages × ${book.milestones.length} milestone(s) -> ${dist}\n  open: ${path.join(dist, 'index.html')}\n  distHash: ${distHash}${chat ? '\n  chat: Ask AI panel enabled (readers send questions to the LLM endpoint they configure)' : ''}${errors ? `\n  note: ${errors} content error(s); run \`redocs check\`` : ''}`,
    dist,
    milestones: book.milestones.map((m) => m.id),
    pages: pageCount,
    files: written.length,
    contentErrors: errors,
    chat,
    distHash,
    htmlFiles,
  };
}
