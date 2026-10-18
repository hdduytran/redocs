// HTML fragment pages (page.json without "standalone": true) get the same extensions as
// Markdown, expressed in HTML:
//   href="page:chapter/page#anchor"   src="asset:wireframes/x.png"   [[svc:billing]]
//   <redocs-embed artifact="id" height="640" caption="..."></redocs-embed>
// h2/h3 without an id get one, so they can be linked and appear in the TOC.

import { escapeHtml } from './shared-helpers.mjs';
import { renderEmbed, renderEntityChip, resolveReference } from './render-redocs-references.mjs';
import { slugAllocator } from './site-paths-and-urls.mjs';

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function decodeEntities(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function readAttributes(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4]);
  return attrs;
}

/** @returns {{html: string, headings: Array<{level:number,text:string,id:string}>}} */
export function renderHtmlFragment(source, ctx) {
  let html = source.replace(/<redocs-embed\b([^>]*)>\s*<\/redocs-embed>|<redocs-embed\b([^>]*)\/>/gi, (match, a, b, offset) => {
    const attrs = readAttributes(a ?? b ?? '');
    const spec = { artifact: attrs.artifact, caption: attrs.caption, title: attrs.title, alt: attrs.alt };
    if (attrs.height) spec.height = Number(attrs.height);
    return renderEmbed(ctx, spec, lineOf(source, offset));
  });

  html = html.replace(/\b(href|src)\s*=\s*"((?:page|asset):[^"]*)"/g, (match, attr, value, offset) => (
    `${attr}="${resolveReference(ctx, decodeEntities(value), lineOf(html, offset))}"`
  ));

  // Entity references only in text, never inside tags or <script>/<style>/<code>/<pre>.
  html = html.replace(/(<(script|style|code|pre)\b[\s\S]*?<\/\2>)|(<[^>]+>)|(\[\[([a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*)(?:\|([^\]\n]+))?\]\])/gi,
    (match, skipped, _tag, tag, ref, id, label, offset) => {
      if (skipped || tag) return match;
      return renderEntityChip(ctx, id, label?.trim(), lineOf(html, offset));
    });

  const nextSlug = slugAllocator();
  const headings = [];
  html = html.replace(/<h([1-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, (match, level, attrs = '', inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    const existing = /\sid\s*=\s*"([^"]+)"/i.exec(attrs);
    const id = existing ? existing[1] : nextSlug(text);
    headings.push({ level: Number(level), text, id });
    return existing ? match : `<h${level}${attrs} id="${escapeHtml(id)}">${inner}</h${level}>`;
  });
  return { html, headings };
}
