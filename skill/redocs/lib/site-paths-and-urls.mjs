// Output layout of dist/ and relative-URL helpers. Every href in the site is relative so the
// book works from any folder over file://.
//
// dist/
// ├── index.html                     -> redirect to <current>/index.html
// ├── _redocs/{redocs.css,redocs.js} shared theme (+ redocs-query/-chat-agent/-chat.js with chat)
// ├── assets/...                     copied book assets
// ├── artifacts/<id>/<output>        copied artifacts (resize script injected)
// └── <milestone>/
//     ├── index.html                 book home at this milestone
//     ├── search-index.js
//     ├── agent-index.js             only when book.json chat.enabled (Ask AI panel)
//     ├── <page-id>.html
//     ├── _standalone/<page-id>.html standalone HTML sources shown in an iframe
//     ├── catalog/index.html, catalog/<type>.html
//     ├── changes/<a>-to-<b>.html
//     └── compare/<page-id>/<a>-vs-<b>.html

import path from 'node:path';

export const SITE = {
  themeCss: '_redocs/redocs.css',
  themeJs: '_redocs/redocs.js',
  pageOut: (milestone, pageId) => `${milestone}/${pageId}.html`,
  standaloneOut: (milestone, pageId) => `${milestone}/_standalone/${pageId}.html`,
  homeOut: (milestone) => `${milestone}/index.html`,
  searchOut: (milestone) => `${milestone}/search-index.js`,
  agentIndexOut: (milestone) => `${milestone}/agent-index.js`,
  chatScripts: ['_redocs/redocs-query.js', '_redocs/redocs-chat-stream.js', '_redocs/redocs-chat-agent.js', '_redocs/redocs-chat-store.js', '_redocs/redocs-chat-render.js', '_redocs/redocs-chat.js'],
  catalogIndexOut: (milestone) => `${milestone}/catalog/index.html`,
  catalogTypeOut: (milestone, type) => `${milestone}/catalog/${type}.html`,
  changesOut: (milestone, from) => `${milestone}/changes/${from}-to-${milestone}.html`,
  compareOut: (milestone, pageId, from) => `${milestone}/compare/${pageId}/${from}-vs-${milestone}.html`,
  assetOut: (assetPath) => `assets/${assetPath}`,
  artifactOut: (id, output) => `artifacts/${id}/${output}`,
};

/** Relative href from one dist file to another (both dist-relative POSIX paths). */
export function relativeHref(fromFile, toFile, hash = '') {
  let rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  if (!rel) rel = path.posix.basename(toFile);
  return encodeURI(rel) + (hash ? `#${encodeURIComponent(hash)}` : '');
}

/** Heading/anchor slug. Keeps it ASCII so it is stable across locales (Vietnamese diacritics are folded). */
export function slugify(text) {
  const folded = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded || 'section';
}

/** Hands out unique slugs within one page (a, a-1, a-2 ...). */
export function slugAllocator() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Anchor used for an entity on its catalog page. */
export function entityAnchor(entityId) {
  return entityId.replace(':', '-');
}
