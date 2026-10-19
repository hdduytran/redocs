// Agent index: the book at ONE milestone as data an LLM can navigate without embeddings.
//
//   L0 map      chapters -> pages (title, kind, summary, entities, open questions)
//   L1 outline  page -> sections (anchor, title, level) cut at h1-h3
//   L2 text     section source text, searched with BM25 by assets/theme/redocs-query.js
//   L3 graph    entities (lifecycle, depends_on, pages that mention them) + milestone change sets
//
// Built from the same in-memory render that `check` validated (renderBookPages), so anchors and
// refs in the index are exactly the ones in dist/. Pure and deterministic: no clock, no I/O
// except reading standalone HTML sources.

import { readFileSync } from 'node:fs';
import { diffMilestones } from './build-generated-pages.mjs';
import { comparisonPairs, isAlive, milestoneOrder } from './milestone-order-and-lifecycle.mjs';
import { renderedKey } from './render-book-pages.mjs';
import { entityAnchor } from './site-paths-and-urls.mjs';

export const AGENT_INDEX_VERSION = 1;
const SECTION_MAX_LEVEL = 3;
const SUMMARY_CHARS = 200;

const ENTITIES = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]);
}

/** HTML -> readable text that keeps block structure (lines, list items, table cells). */
export function htmlToReadableText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, (m, alt) => (alt ? ` [image: ${alt}] ` : ' '))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/(p|div|section|article|aside|tr|h[1-6]|pre|blockquote|table|ul|ol|figure|figcaption|dd|dt|header|footer|main|nav)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A `redocs-embed` block becomes one readable line naming the artifact. */
function describeEmbeds(text, book) {
  return text.replace(/```redocs-embed\s*\n([\s\S]*?)```/g, (match, json) => {
    try {
      const spec = JSON.parse(json);
      const receipt = book.artifacts.get(spec.artifact)?.receipt;
      const title = spec.caption || spec.title || receipt?.title || spec.artifact;
      return `[embedded ${receipt?.plugin || 'artifact'} "${spec.artifact}": ${title}]`;
    } catch {
      return match;
    }
  });
}

function sectionsFromMarkdown(source, headings, book) {
  const lines = source.split('\n');
  const cuts = headings.filter((h) => h.level <= SECTION_MAX_LEVEL && Number.isInteger(h.line));
  const sections = [];
  const push = (anchor, title, level, from, to) => {
    const text = describeEmbeds(lines.slice(from, to).join('\n'), book).trim();
    if (text || anchor) sections.push({ anchor, title, level, text });
  };
  if (!cuts.length) {
    push('', '', 1, 0, lines.length);
    return sections;
  }
  if (cuts[0].line > 0) push('', '', 1, 0, cuts[0].line);
  cuts.forEach((h, i) => push(h.id, h.text, h.level, h.line, i + 1 < cuts.length ? cuts[i + 1].line : lines.length));
  return sections;
}

function sectionsFromHtml(bodyHtml) {
  const re = /<h([1-6])\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  const cuts = [];
  for (const m of bodyHtml.matchAll(re)) {
    if (Number(m[1]) <= SECTION_MAX_LEVEL) cuts.push({ at: m.index, level: Number(m[1]), id: decodeEntities(m[2]), title: htmlToReadableText(m[3]) });
  }
  const sections = [];
  const push = (anchor, title, level, from, to) => {
    const text = htmlToReadableText(bodyHtml.slice(from, to));
    if (text || anchor) sections.push({ anchor, title, level, text });
  };
  if (!cuts.length) {
    push('', '', 1, 0, bodyHtml.length);
    return sections;
  }
  if (cuts[0].at > 0) push('', '', 1, 0, cuts[0].at);
  cuts.forEach((c, i) => push(c.id, c.title, c.level, c.at, i + 1 < cuts.length ? cuts[i + 1].at : bodyHtml.length));
  return sections;
}

function stripMarkdown(text) {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First real paragraph (not a heading, quote, code, table, list or owner question), cut at a word.
 *  A lead-in line ending with ":" ("Recommended content:") is used only when nothing better exists. */
function autoSummary(sections) {
  const blocks = sections.map((s) => s.text).join('\n\n').split(/\n\s*\n/);
  let leadIn = '';
  for (const block of blocks) {
    const first = block.replace(/^\n+/, '');
    if (/^[ \t]{2,}/.test(first)) continue; // continuation of a list item
    const text = stripMarkdown(first.trim());
    if (!text || /^(#|>|```|\||- |\* |\d+\.|\[embedded )/.test(first.trim()) || /TODO\(owner\)/.test(first)) continue;
    if (text.length < 20) continue;
    if (text.endsWith(':')) {
      leadIn ||= text;
      continue;
    }
    if (text.length <= SUMMARY_CHARS) return text;
    const cut = text.slice(0, SUMMARY_CHARS);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SUMMARY_CHARS * 0.6))}…`;
  }
  return leadIn.slice(0, SUMMARY_CHARS);
}

function orderedPageIds(book) {
  const listed = (book.config.chapters || []).flatMap((c) => c.pages).filter((id) => book.pages.has(id));
  const rest = [...book.pages.keys()].filter((id) => !listed.includes(id)).sort();
  return [...new Set([...listed, ...rest])];
}

function pageEntry(book, r) {
  const { page } = r;
  const meta = page.meta;
  let sections = [];
  if (r.resolved) {
    if (r.standalone) {
      let html = '';
      try { html = readFileSync(r.standalone.from, 'utf8'); } catch { html = ''; }
      const text = htmlToReadableText(html.replace(/^[\s\S]*?<body\b[^>]*>/i, ''));
      sections = text ? [{ anchor: '', title: '', level: 1, text }] : [];
    } else if (r.sourceFormat === 'md') {
      sections = sectionsFromMarkdown(r.rawSource, r.headings, book);
    } else if (r.sourceFormat === 'html') {
      sections = sectionsFromHtml(r.bodyHtml);
    }
  }
  const entities = [...new Set([...(meta.entities || []), ...r.ctx.entityRefs.map((e) => e.id)])].filter((id) => book.entities.has(id)).sort();
  const entry = {
    id: page.id,
    title: meta.title,
    kind: meta.kind,
    summary: meta.summary || autoSummary(sections),
    summarySource: meta.summary ? 'page.json' : 'auto',
    exists: Boolean(r.resolved),
    entities,
    links: [...new Set(r.ctx.links.map((l) => l.target))].filter((id) => id !== page.id).sort(),
    anchors: r.headings.map((h) => h.id),
    todos: (r.rawSource.match(/TODO\(owner\)/g) || []).length,
    sections,
  };
  if (meta.status) entry.status = meta.status;
  if (meta.owner) entry.owner = meta.owner;
  if (meta.updated) entry.updated = meta.updated;
  if (r.resolved?.variant) entry.variant = r.resolved.variant;
  if (r.resolved?.inheritedFrom) entry.inheritedFrom = r.resolved.inheritedFrom;
  if (!r.resolved && page.variants) entry.startsAt = Object.keys(page.variants)[0];
  return entry;
}

function changeSets(book) {
  return comparisonPairs(book.milestones).map(([from, to]) => {
    const d = diffMilestones(book, from, to);
    return {
      from,
      to,
      added: d.added.map((e) => e.id),
      replaced: d.replaced.map((e) => ({ id: e.id, by: e.replaced_by })),
      removed: d.removed.map((e) => e.id),
      changedPages: d.changedPages,
    };
  });
}

/**
 * @param {object} book loaded book
 * @param {Map<string, object>} rendered renderBookPages().pages
 * @param {string} milestone
 */
export function buildAgentIndex(book, rendered, milestone, shared = {}) {
  const order = milestoneOrder(book.milestones);
  const m = book.milestones.find((x) => x.id === milestone);
  const pages = orderedPageIds(book).map((id) => pageEntry(book, rendered.get(renderedKey(milestone, id))));
  const mentions = new Map();
  for (const p of pages) for (const id of p.entities) mentions.set(id, [...(mentions.get(id) || []), p.id]);
  const entities = [...book.entities.values()].sort((a, b) => a.id.localeCompare(b.id)).map((e) => {
    const out = { id: e.id, type: e.type, name: e.name };
    for (const key of ['summary', 'owner', 'tech', 'depends_on', 'since', 'until', 'replaced_by', 'links']) if (e[key] !== undefined) out[key] = e[key];
    out.alive = isAlive(e, milestone, order);
    out.url = `catalog/${e.type}.html#${entityAnchor(e.id)}`;
    out.pages = mentions.get(e.id) || [];
    return out;
  });
  return {
    version: AGENT_INDEX_VERSION,
    book: { id: book.config.id, title: book.config.title, language: book.config.language || 'en' },
    milestone: { id: m.id, label: m.label, status: m.status },
    milestones: book.milestones.map((x) => ({ id: x.id, label: x.label, status: x.status, ...(x.description ? { description: x.description } : {}) })),
    chapters: (book.config.chapters || []).map((c) => ({ id: c.id, title: c.title, pages: c.pages.filter((id) => book.pages.has(id)) })),
    pages,
    entities,
    changes: shared.changes || changeSets(book),
  };
}

/** One index per milestone (change sets computed once). */
export function buildAgentIndexes(book, rendered) {
  const changes = changeSets(book);
  return new Map(book.milestones.map((m) => [m.id, buildAgentIndex(book, rendered, m.id, { changes })]));
}

/** The file the reader loads with <script src> (works over file://). */
export function agentIndexScript(index) {
  return `window.__REDOCS_AGENT_INDEX=${JSON.stringify(index)};\n`;
}
