// The book chrome around every page: header (title, milestone switcher, search, theme),
// sidebar navigation, milestone badge + notices, body, page TOC and footer metadata.
// Pure function of its inputs; no timestamps so builds are reproducible.

import path from 'node:path';
import { comparisonPairs } from './milestone-order-and-lifecycle.mjs';
import { escapeHtml } from './shared-helpers.mjs';
import { relativeHref, SITE } from './site-paths-and-urls.mjs';

function milestoneSwitcher({ book, milestone, outFile, switchTargets }) {
  const items = book.milestones.map((m) => {
    const target = switchTargets?.[m.id] || SITE.homeOut(m.id);
    const current = m.id === milestone;
    return `<li><a class="rd-ms rd-ms--${escapeHtml(m.status)}${current ? ' is-active' : ''}" href="${relativeHref(outFile, target)}"${current ? ' aria-current="true"' : ''} title="${escapeHtml(m.description || m.status)}">${escapeHtml(m.label)}</a></li>`;
  }).join('');
  return `<nav class="rd-milestones" aria-label="Milestones"><ul>${items}</ul></nav>`;
}

function sidebar({ book, milestone, outFile, activeFile }) {
  const link = (target, label) => {
    const active = target === activeFile;
    return `<li><a href="${relativeHref(outFile, target)}"${active ? ' aria-current="page" class="is-active"' : ''}>${escapeHtml(label)}</a></li>`;
  };
  const chapters = (book.config.chapters || []).map((chapter) => {
    const pages = chapter.pages
      .filter((id) => book.pages.has(id))
      .map((id) => link(SITE.pageOut(milestone, id), book.pages.get(id).meta.title))
      .join('');
    return `<li class="rd-nav__chapter"><span class="rd-nav__chapter-title">${escapeHtml(chapter.title)}</span><ul>${pages}</ul></li>`;
  }).join('');

  const types = [...new Set([...book.entities.values()].map((e) => e.type))].sort();
  const catalog = types.length
    ? `<li class="rd-nav__chapter"><span class="rd-nav__chapter-title">Catalog</span><ul>${link(SITE.catalogIndexOut(milestone), 'All entities')}${types.map((t) => link(SITE.catalogTypeOut(milestone, t), t)).join('')}</ul></li>`
    : '';
  const pairs = comparisonPairs(book.milestones).filter(([, to]) => to === milestone);
  const changes = pairs.length
    ? `<li class="rd-nav__chapter"><span class="rd-nav__chapter-title">Changes</span><ul>${pairs.map(([from]) => link(SITE.changesOut(milestone, from), `${from} → ${milestone}`)).join('')}</ul></li>`
    : '';
  return `<nav class="rd-nav" id="rd-nav" aria-label="Book contents"><ul>${chapters}${catalog}${changes}</ul></nav>`;
}

function toc(headings) {
  const items = (headings || []).filter((h) => h.level === 2 || h.level === 3);
  if (items.length < 2) return '';
  return `<aside class="rd-toc" aria-label="On this page"><p class="rd-toc__title">On this page</p><ul>${items
    .map((h) => `<li class="rd-toc__l${h.level}"><a href="#${encodeURIComponent(h.id)}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></aside>`;
}

/**
 * @param {object} o
 * @param {object} o.book
 * @param {string} o.milestone
 * @param {string} o.outFile dist-relative output path
 * @param {string} o.title
 * @param {string} o.bodyHtml
 * @param {Array} [o.headings]
 * @param {Record<string,string>} [o.switchTargets] milestone -> dist file of "this page" there
 * @param {string[]} [o.notices] trusted HTML snippets shown above the body
 * @param {string} [o.footerHtml] trusted HTML
 * @param {string} [o.kind]
 * @param {boolean} [o.wide] hide the TOC column (compare pages)
 */
export function renderShell(o) {
  const { book, milestone, outFile } = o;
  const m = book.milestones.find((x) => x.id === milestone);
  const lang = book.config.language || 'en';
  const css = relativeHref(outFile, SITE.themeCss);
  const js = relativeHref(outFile, SITE.themeJs);
  const search = relativeHref(outFile, SITE.searchOut(milestone));
  const home = relativeHref(outFile, SITE.homeOut(milestone));
  // Search results are stored relative to the milestone folder; this prefix gets there from here.
  const toMilestoneRoot = path.posix.relative(path.posix.dirname(outFile), milestone);
  const searchBase = toMilestoneRoot ? `${toMilestoneRoot}/` : '';
  const notices = (o.notices || []).map((n) => `<div class="rd-notice" role="note">${n}</div>`).join('');
  const kind = o.kind ? `<span class="rd-kind">${escapeHtml(o.kind)}</span>` : '';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" data-milestone="${escapeHtml(milestone)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ReDocs">
<title>${escapeHtml(o.title)} · ${escapeHtml(book.config.title)} (${escapeHtml(m?.label || milestone)})</title>
<script>try{var t=localStorage.getItem('redocs-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
<link rel="stylesheet" href="${css}">
</head>
<body>
<a class="rd-skip" href="#rd-main">Skip to content</a>
<header class="rd-header">
  <button class="rd-menu" type="button" aria-controls="rd-nav" aria-expanded="false" aria-label="Toggle navigation">☰</button>
  <a class="rd-brand" href="${home}">${escapeHtml(book.config.title)}</a>
  ${milestoneSwitcher({ book, milestone, outFile, switchTargets: o.switchTargets })}
  <div class="rd-search" role="search">
    <label class="rd-visually-hidden" for="rd-search-input">Search this book</label>
    <input id="rd-search-input" type="search" placeholder="Search…" autocomplete="off" data-base="${escapeHtml(searchBase)}" aria-controls="rd-search-results">
    <ul id="rd-search-results" class="rd-search__results" role="listbox" hidden></ul>
  </div>
  <button class="rd-theme" type="button" aria-label="Toggle dark mode">◐</button>
</header>
<div class="rd-layout${o.wide ? ' rd-layout--wide' : ''}">
${sidebar({ book, milestone, outFile, activeFile: outFile })}
<main id="rd-main" class="rd-main" tabindex="-1">
  <p class="rd-context"><span class="rd-badge rd-badge--ms rd-badge--${escapeHtml(m?.status || '')}">${escapeHtml(m?.label || milestone)} · ${escapeHtml(m?.status || '')}</span>${kind}</p>
  ${notices}
  <article class="rd-article">
${o.bodyHtml}
  </article>
  ${o.footerHtml ? `<footer class="rd-page-footer">${o.footerHtml}</footer>` : ''}
</main>
${o.wide ? '' : toc(o.headings)}
</div>
<script src="${search}"></script>
<script src="${js}"></script>
</body>
</html>
`;
}
