/* ReDocs agent query: book_map / book_outline / book_search / book_read / book_entity /
 * book_changes / book_citations over ONE milestone's agent index (built by
 * lib/build-agent-index.mjs).
 *
 * Vectorless retrieval: the model navigates the book's own structure (chapters -> pages ->
 * sections, entity registry, milestone diffs) and a BM25 keyword index, instead of embeddings.
 *
 * A classic script on purpose (no import/export): the reader loads it with <script src> over
 * file:// (module scripts are blocked there) and it sets globalThis.RedocsQuery; Node imports it
 * for that side effect through lib/query-book-index.mjs. Pure functions of the index: no network,
 * no DOM, no clock, so results are reproducible and testable. */
(function (root) {
  'use strict';

  var MAP_PAGE_LIMIT = 150;
  var MAP_TEXT_LIMIT = 12000;
  var DEFAULT_READ_CHARS = 8000;
  var MAX_READ_CHARS = 40000;
  var DEFAULT_K = 8;
  var MAX_K = 30;
  var PER_PAGE_HITS = 3;
  var SNIPPET_CHARS = 240;

  // ---- text folding (diacritics-insensitive, index-aligned) ------------------------------------

  // Fold one UTF-16 unit to exactly one character, so a position in the folded text is the same
  // position in the original text (snippets slice the original).
  function foldChar(c) {
    var code = c.charCodeAt(0);
    if (code < 128) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : c;
    if (c === '\u0111' || c === '\u0110') return 'd'; // đ Đ
    var f = c.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return f.length === 1 ? f : c.toLowerCase().charAt(0) || c;
  }

  function fold(text) {
    var s = String(text == null ? '' : text);
    var out = '';
    for (var i = 0; i < s.length; i += 1) out += foldChar(s[i]);
    return out;
  }

  function tokenize(text) {
    return fold(text).split(/[^a-z0-9]+/).filter(function (t) { return t.length >= 2 || /\d/.test(t); });
  }

  // ---- small helpers ----------------------------------------------------------------------------

  function clampInt(value, fallback, min, max) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function fail(error, hint, extra) {
    var out = { ok: false, error: error };
    if (hint) out.hint = hint;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  function findPage(index, id) {
    for (var i = 0; i < index.pages.length; i += 1) if (index.pages[i].id === id) return index.pages[i];
    return null;
  }

  function findEntity(index, id) {
    for (var i = 0; i < index.entities.length; i += 1) if (index.entities[i].id === id) return index.entities[i];
    return null;
  }

  /** Closest ids by folded substring / shared tokens, for "did you mean" hints. */
  function suggest(ids, wanted, limit) {
    var w = fold(wanted);
    var wt = tokenize(wanted);
    var scored = ids.map(function (id) {
      var f = fold(id);
      var score = f.indexOf(w) >= 0 || w.indexOf(f) >= 0 ? 10 : 0;
      wt.forEach(function (t) { if (f.indexOf(t) >= 0) score += 1; });
      return { id: id, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : 1); });
    return scored.slice(0, limit || 5).map(function (x) { return x.id; });
  }

  /** "page:a/b#c" | "a/b#c" | "a/b" -> {page, anchor}. */
  function parseRef(ref) {
    var raw = String(ref || '').trim().replace(/^page:/, '');
    var hash = raw.indexOf('#');
    return { page: hash >= 0 ? raw.slice(0, hash) : raw, anchor: hash >= 0 ? raw.slice(hash + 1) : '' };
  }

  function pageRef(pageId, anchor) {
    return 'page:' + pageId + (anchor ? '#' + anchor : '');
  }

  function pageUrl(pageId, anchor) {
    return pageId + '.html' + (anchor ? '#' + encodeURIComponent(anchor) : '');
  }

  function chapterOf(index, pageId) {
    for (var i = 0; i < index.chapters.length; i += 1) {
      if (index.chapters[i].pages.indexOf(pageId) >= 0) return index.chapters[i].id;
    }
    return null;
  }

  // ---- book_map ---------------------------------------------------------------------------------

  function pageCard(p) {
    var card = { id: p.id, title: p.title, kind: p.kind, summary: p.summary || '' };
    if (p.status) card.status = p.status;
    if (!p.exists) card.exists = false;
    if (p.entities.length) card.entities = p.entities;
    card.sections = p.sections.length;
    if (p.todos) card.openQuestions = p.todos;
    return card;
  }

  function map(index, options) {
    var o = options || {};
    var listed = {};
    var chapters = index.chapters;
    if (o.chapter) {
      chapters = chapters.filter(function (c) { return c.id === o.chapter; });
      if (!chapters.length) {
        return fail("Unknown chapter '" + o.chapter + "'", 'Chapters: ' + index.chapters.map(function (c) { return c.id; }).join(', '));
      }
    }
    var collapse = !o.chapter && index.pages.length > MAP_PAGE_LIMIT;
    var outChapters = chapters.map(function (c) {
      c.pages.forEach(function (id) { listed[id] = true; });
      var entry = { id: c.id, title: c.title, pageCount: c.pages.length };
      if (!collapse) entry.pages = c.pages.map(function (id) { return findPage(index, id); }).filter(Boolean).map(pageCard);
      return entry;
    });
    var result = {
      ok: true,
      book: index.book,
      milestone: index.milestone,
      milestones: index.milestones,
      chapters: outChapters,
      entityTypes: entityTypeCounts(index),
    };
    if (!o.chapter) {
      var unlisted = index.pages.filter(function (p) { return !listed[p.id]; });
      if (unlisted.length) result.unlisted = unlisted.map(pageCard);
    }
    if (collapse) {
      result.truncated = true;
      result.hint = 'The book has ' + index.pages.length + ' pages; call book_map with {"chapter": "<id>"} to list one chapter.';
    }
    return result;
  }

  function entityTypeCounts(index) {
    var counts = {};
    index.entities.forEach(function (e) {
      var c = counts[e.type] || (counts[e.type] = { alive: 0, total: 0 });
      c.total += 1;
      if (e.alive) c.alive += 1;
    });
    return counts;
  }

  /** Compact text form of the map for prompts and terminals. Falls back to chapters only when long. */
  function mapText(index, options) {
    var o = options || {};
    var limit = o.limit || MAP_TEXT_LIMIT;
    var head = 'Book: ' + index.book.title + ' (' + index.book.id + ') · milestone ' + index.milestone.label
      + ' [' + index.milestone.status + '] · milestones: ' + index.milestones.map(function (m) { return m.id; }).join(', ');
    var full = [head];
    index.chapters.forEach(function (c) {
      full.push('', '## ' + c.title + ' (' + c.id + ')');
      c.pages.forEach(function (id) {
        var p = findPage(index, id);
        if (!p) return;
        full.push('- ' + pageRef(p.id) + ' · ' + p.title + ' [' + p.kind + (p.exists ? '' : ', not at this milestone') + ']'
          + (p.summary ? ' · ' + p.summary : '') + (p.todos ? ' · ' + p.todos + ' open question(s)' : ''));
      });
    });
    var types = entityTypeCounts(index);
    var typeNames = Object.keys(types).sort();
    if (typeNames.length) {
      full.push('', 'Entities (alive/total): ' + typeNames.map(function (t) { return t + ' ' + types[t].alive + '/' + types[t].total; }).join(', '));
    }
    var text = full.join('\n');
    if (text.length <= limit) return text;
    var short = [head, ''];
    index.chapters.forEach(function (c) { short.push('- chapter ' + c.id + ' · ' + c.title + ' · ' + c.pages.length + ' page(s)'); });
    short.push('', 'The full map is too long; call book_map with {"chapter": "<id>"} to see a chapter\'s pages.');
    return short.join('\n');
  }

  // ---- book_outline -----------------------------------------------------------------------------

  function outline(index, pageId) {
    var id = parseRef(pageId).page;
    var p = findPage(index, id);
    if (!p) return fail("Unknown page '" + id + "'", 'Did you mean: ' + (suggest(index.pages.map(function (x) { return x.id; }), id).join(', ') || '(no close match; call book_map)'));
    var result = {
      ok: true,
      page: p.id,
      ref: pageRef(p.id),
      title: p.title,
      kind: p.kind,
      chapter: chapterOf(index, p.id),
      summary: p.summary || '',
      url: pageUrl(p.id),
      exists: p.exists,
      sections: p.sections.map(function (s) {
        return { anchor: s.anchor, ref: pageRef(p.id, s.anchor), title: s.title || '(intro)', level: s.level, chars: s.text.length };
      }),
      entities: p.entities,
      links: p.links,
    };
    if (p.status) result.status = p.status;
    if (p.inheritedFrom) result.inheritedFrom = p.inheritedFrom;
    if (p.startsAt) result.startsAt = p.startsAt;
    if (p.todos) result.openQuestions = p.todos;
    return result;
  }

  // ---- book_search (BM25 over sections + entities) -------------------------------------------

  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function repeatTokens(tokens, times) {
    var out = [];
    for (var i = 0; i < times; i += 1) out = out.concat(tokens);
    return out;
  }

  function buildSearchIndex(index) {
    if (cache && cache.has(index)) return cache.get(index);
    var docs = [];
    index.pages.forEach(function (p) {
      if (!p.exists) return;
      p.sections.forEach(function (s, i) {
        var text = s.text;
        var tokens = tokenize(text)
          .concat(repeatTokens(tokenize(s.title), 2))
          .concat(repeatTokens(tokenize(p.title), 2))
          .concat(i === 0 ? tokenize(p.summary) : []);
        docs.push({ kind: 'section', page: p.id, anchor: s.anchor, title: p.title, section: s.title, pageKind: p.kind, text: text, folded: fold(text), tokens: tokens });
      });
    });
    index.entities.forEach(function (e) {
      var text = [e.id, e.name, e.type, e.summary, (e.tech || []).join(' '), e.owner].filter(Boolean).join(' · ');
      docs.push({ kind: 'entity', entity: e.id, title: e.name, section: e.type, pageKind: e.type, text: text, folded: fold(text), tokens: tokenize(text).concat(repeatTokens(tokenize(e.name), 2)) });
    });
    var df = {};
    var total = 0;
    docs.forEach(function (d) {
      d.tf = {};
      d.tokens.forEach(function (t) { d.tf[t] = (d.tf[t] || 0) + 1; });
      Object.keys(d.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      d.length = d.tokens.length;
      total += d.length;
    });
    var built = { docs: docs, df: df, vocab: Object.keys(df).sort(), avgdl: docs.length ? total / docs.length : 1 };
    if (cache) cache.set(index, built);
    return built;
  }

  /** Query token -> [{token, weight}]: exact match, else vocabulary words it prefixes. */
  function expandToken(si, token) {
    if (si.df[token]) return [{ token: token, weight: 1 }];
    if (token.length < 3) return [];
    var out = [];
    for (var i = 0; i < si.vocab.length && out.length < 12; i += 1) {
      if (si.vocab[i].indexOf(token) === 0) out.push({ token: si.vocab[i], weight: 0.6 });
    }
    return out;
  }

  function snippetOf(doc, terms) {
    var at = -1;
    for (var i = 0; i < terms.length; i += 1) {
      var re = new RegExp('(^|[^a-z0-9])' + terms[i].replace(/[^a-z0-9]/g, ''));
      var m = re.exec(doc.folded);
      if (m && (at < 0 || m.index + m[1].length < at)) at = m.index + m[1].length;
    }
    var text = doc.text;
    if (at < 0) at = 0;
    var start = Math.max(0, at - 80);
    var piece = text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
    return (start > 0 ? '…' : '') + piece + (start + SNIPPET_CHARS < text.length ? '…' : '');
  }

  function search(index, query, options) {
    var o = options || {};
    var k = clampInt(o.k, DEFAULT_K, 1, MAX_K);
    var queryTokens = tokenize(query);
    if (!queryTokens.length) return fail('Empty query', 'Pass words to look for, e.g. {"query": "billing database"}.');
    var si = buildSearchIndex(index);
    var N = si.docs.length;
    var unique = queryTokens.filter(function (t, i) { return queryTokens.indexOf(t) === i; });
    var expanded = unique.map(function (t) { return expandToken(si, t); });
    var phrase = unique.length > 1 ? fold(query).replace(/[^a-z0-9]+/g, ' ').trim() : '';
    var inChapter = o.chapter ? (index.chapters.filter(function (c) { return c.id === o.chapter; })[0] || { pages: [] }).pages : null;
    var k1 = 1.2;
    var b = 0.75;
    var hits = [];
    si.docs.forEach(function (d) {
      if (o.kind && d.pageKind !== o.kind) return;
      if (inChapter && (d.kind !== 'section' || inChapter.indexOf(d.page) < 0)) return;
      var score = 0;
      var matched = 0;
      expanded.forEach(function (variants) {
        var best = 0;
        variants.forEach(function (v) {
          var tf = d.tf[v.token];
          if (!tf) return;
          var idf = Math.log(1 + (N - si.df[v.token] + 0.5) / (si.df[v.token] + 0.5));
          var s = v.weight * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.length / si.avgdl));
          if (s > best) best = s;
        });
        if (best > 0) matched += 1;
        score += best;
      });
      if (!score) return;
      score *= 0.5 + 0.5 * (matched / unique.length); // documents matching more of the query rank higher
      if (phrase && d.folded.replace(/[^a-z0-9]+/g, ' ').indexOf(phrase) >= 0) score *= 1.5;
      hits.push({ d: d, score: score });
    });
    hits.sort(function (x, y) {
      return y.score - x.score || String(x.d.page || x.d.entity).localeCompare(String(y.d.page || y.d.entity)) || String(x.d.anchor || '').localeCompare(String(y.d.anchor || ''));
    });
    var perPage = {};
    var results = [];
    for (var i = 0; i < hits.length && results.length < k; i += 1) {
      var d = hits[i].d;
      var key = d.page || d.entity;
      perPage[key] = (perPage[key] || 0) + 1;
      if (perPage[key] > PER_PAGE_HITS) continue;
      var r = d.kind === 'section'
        ? { ref: pageRef(d.page, d.anchor), page: d.page, anchor: d.anchor, title: d.title, section: d.section || '(intro)', kind: d.pageKind, url: pageUrl(d.page, d.anchor) }
        : { ref: 'entity:' + d.entity, entity: d.entity, title: d.title, kind: d.pageKind };
      r.score = Math.round(hits[i].score * 1000) / 1000;
      r.snippet = snippetOf(d, unique);
      results.push(r);
    }
    var out = { ok: true, query: String(query), milestone: index.milestone.id, total: hits.length, results: results };
    if (!results.length) out.hint = 'No match. Try synonyms, the English technical term, or the other language; or browse with book_map.';
    return out;
  }

  // ---- book_read --------------------------------------------------------------------------------

  function read(index, ref, options) {
    var o = options || {};
    var parsed = parseRef(ref);
    if (/^entity:/.test(String(ref || '').trim())) return fail('book_read reads pages; use book_entity for ' + ref);
    var p = findPage(index, parsed.page);
    if (!p) return fail("Unknown page '" + parsed.page + "'", 'Did you mean: ' + (suggest(index.pages.map(function (x) { return x.id; }), parsed.page).join(', ') || '(no close match; call book_map)'));
    if (!p.exists) return fail("Page '" + p.id + "' does not exist at milestone " + index.milestone.id, p.startsAt ? 'It starts at milestone ' + p.startsAt + '.' : '');
    var sections = p.sections;
    var heading = '';
    if (parsed.anchor) {
      var at = -1;
      for (var i = 0; i < sections.length; i += 1) if (sections[i].anchor === parsed.anchor) at = i;
      if (at < 0) {
        if (p.anchors.indexOf(parsed.anchor) >= 0) return fail("'#" + parsed.anchor + "' is a minor heading inside a larger section", 'Read the page or one of: ' + sections.map(function (s) { return s.anchor; }).filter(Boolean).join(', '));
        return fail("No section '#" + parsed.anchor + "' on page '" + p.id + "'", 'Sections: ' + (sections.map(function (s) { return s.anchor; }).filter(Boolean).join(', ') || '(none)'));
      }
      var level = sections[at].level;
      var end = at + 1;
      while (end < sections.length && sections[end].level > level) end += 1;
      heading = sections[at].title;
      sections = sections.slice(at, end);
    }
    var text = sections.map(function (s) { return s.text; }).join('\n\n');
    var maxChars = clampInt(o.maxChars, DEFAULT_READ_CHARS, 200, MAX_READ_CHARS);
    var offset = clampInt(o.offset, 0, 0, text.length);
    var slice = text.slice(offset, offset + maxChars);
    var result = {
      ok: true,
      ref: pageRef(p.id, parsed.anchor),
      page: p.id,
      anchor: parsed.anchor,
      title: p.title,
      section: heading || null,
      milestone: index.milestone.id,
      url: pageUrl(p.id, parsed.anchor),
      offset: offset,
      totalChars: text.length,
      truncated: offset + slice.length < text.length,
      text: slice,
    };
    if (p.inheritedFrom) result.inheritedFrom = p.inheritedFrom;
    if (result.truncated) result.nextOffset = offset + slice.length;
    return result;
  }

  // ---- book_entity ------------------------------------------------------------------------------

  function entity(index, id) {
    var wanted = String(id || '').trim().replace(/^entity:/, '');
    var e = findEntity(index, wanted);
    if (!e) {
      var near = suggest(index.entities.map(function (x) { return x.id; }).concat(index.entities.map(function (x) { return x.name; })), wanted);
      return fail("Unknown entity '" + wanted + "'", 'Did you mean: ' + (near.join(', ') || '(none; try book_search)'));
    }
    var dependents = index.entities.filter(function (x) { return (x.depends_on || []).indexOf(e.id) >= 0; }).map(function (x) { return x.id; });
    var replaces = index.entities.filter(function (x) { return x.replaced_by === e.id; }).map(function (x) { return x.id; });
    var result = { ok: true, milestone: index.milestone.id, entity: {}, alive: e.alive, url: e.url, pages: [], dependents: dependents, replaces: replaces };
    ['id', 'type', 'name', 'summary', 'owner', 'tech', 'depends_on', 'since', 'until', 'replaced_by', 'links'].forEach(function (key) {
      if (e[key] !== undefined && e[key] !== null && !(Array.isArray(e[key]) && !e[key].length)) result.entity[key] = e[key];
    });
    result.pages = e.pages.map(function (pid) {
      var p = findPage(index, pid);
      return { ref: pageRef(pid), title: p ? p.title : pid };
    });
    return result;
  }

  // ---- book_changes -----------------------------------------------------------------------------

  function changes(index, options) {
    var o = options || {};
    var pairs = index.changes.filter(function (c) {
      if (o.from || o.to) return (!o.from || c.from === o.from) && (!o.to || c.to === o.to);
      return c.to === index.milestone.id;
    });
    if (!pairs.length) {
      return fail('No change set for ' + (o.from || '*') + ' -> ' + (o.to || index.milestone.id),
        'Available: ' + (index.changes.map(function (c) { return c.from + '->' + c.to; }).join(', ') || '(single milestone book)'));
    }
    return { ok: true, changes: pairs };
  }

  // ---- book_citations ---------------------------------------------------------------------------

  /** Find page:<id>#<anchor> references in a text (an answer) and check each one exists. */
  function citations(index, text) {
    var re = /page:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?:#([a-z0-9][a-z0-9-]*))?/g;
    var seen = {};
    var out = [];
    var m;
    var s = String(text || '');
    while ((m = re.exec(s))) {
      var ref = m[0];
      if (seen[ref]) continue;
      seen[ref] = true;
      var p = findPage(index, m[1]);
      var anchor = m[2] || '';
      var valid = Boolean(p && p.exists && (!anchor || p.anchors.indexOf(anchor) >= 0));
      out.push({ ref: ref, page: m[1], anchor: anchor, valid: valid, url: p ? pageUrl(p.id, anchor) : null });
    }
    return { ok: true, citations: out, invalid: out.filter(function (c) { return !c.valid; }).length };
  }

  // ---- tool specs + dispatch (shared by the browser chat and the MCP server) ------------------

  var TOOL_SPECS = [
    {
      name: 'book_map',
      description: 'Table of contents of the book at this milestone: chapters, pages (id, title, kind, one-line summary, entities, section count, open questions) and entity counts. Start here. For large books pass a chapter id.',
      input_schema: { type: 'object', properties: { chapter: { type: 'string', description: 'Chapter id to list (optional).' } }, additionalProperties: false },
    },
    {
      name: 'book_outline',
      description: 'Sections of one page (anchor, title, level, size), its entities and the pages it links to. Use before book_read to pick a section.',
      input_schema: { type: 'object', properties: { page: { type: 'string', description: 'Page id, e.g. "network/topology".' } }, required: ['page'], additionalProperties: false },
    },
    {
      name: 'book_search',
      description: 'Keyword search (BM25, accent-insensitive) over page sections and entities. Returns refs with snippets. Try several phrasings: the reader\'s words, synonyms, the English technical term.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for.' },
          k: { type: 'integer', description: 'Max results (default 8, max 30).' },
          kind: { type: 'string', description: 'Only this page kind (e.g. service, proposal) or entity type.' },
          chapter: { type: 'string', description: 'Only pages in this chapter.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'book_read',
      description: 'Read a page or one section (with its subsections) as source text. ref is "page:<id>" or "page:<id>#<anchor>". Long text is paged: pass nextOffset back as offset.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'page:<id>[#<anchor>]' },
          maxChars: { type: 'integer', description: 'Default 8000, max 40000.' },
          offset: { type: 'integer', description: 'Continue from this character offset.' },
        },
        required: ['ref'],
        additionalProperties: false,
      },
    },
    {
      name: 'book_entity',
      description: 'A registered component (service, datastore, queue, zone, …): summary, owner, tech, dependencies, dependents, lifecycle (since/until/replaced_by), whether it exists at this milestone, and the pages that mention it.',
      input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Entity id, e.g. "svc:billing".' } }, required: ['id'], additionalProperties: false },
    },
    {
      name: 'book_changes',
      description: 'What changes between two milestones: entities added, replaced, removed, and pages with new content. Without arguments: the change sets ending at this milestone.',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'book_citations',
      description: 'Check the page:<id>#<anchor> references in a draft answer; reports which ones do not exist.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    },
  ];

  function dispatch(index, name, input) {
    var a = input || {};
    try {
      switch (name) {
        case 'book_map': return map(index, { chapter: a.chapter });
        case 'book_outline': return outline(index, a.page);
        case 'book_search': return search(index, a.query, { k: a.k, kind: a.kind, chapter: a.chapter });
        case 'book_read': return read(index, a.ref, { maxChars: a.maxChars, offset: a.offset });
        case 'book_entity': return entity(index, a.id);
        case 'book_changes': return changes(index, { from: a.from, to: a.to });
        case 'book_citations': return citations(index, a.text);
        default: return fail("Unknown tool '" + name + "'", 'Tools: ' + TOOL_SPECS.map(function (t) { return t.name; }).join(', '));
      }
    } catch (error) {
      return fail('Tool ' + name + ' failed: ' + (error && error.message ? error.message : String(error)));
    }
  }

  root.RedocsQuery = {
    version: 1,
    TOOL_SPECS: TOOL_SPECS,
    dispatch: dispatch,
    map: map,
    mapText: mapText,
    outline: outline,
    search: search,
    read: read,
    entity: entity,
    changes: changes,
    citations: citations,
    fold: fold,
    tokenize: tokenize,
    parseRef: parseRef,
    pageUrl: pageUrl,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
