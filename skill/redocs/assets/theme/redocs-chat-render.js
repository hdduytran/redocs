/* ReDocs chat rendering: model text -> safe HTML. Markdown (headings, tables, nested lists,
 * blockquotes, code, links) is parsed by the vendored markdown-it with raw HTML escaped and images
 * off; page:/entity: refs become links into the book (unknown refs are struck through). A small
 * built-in subset is the fallback if markdown-it is missing. No DOM: returns strings, so the same
 * code renders live answers, restored conversations and Node tests. */
(function (root) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /** @param {{index: object, base: string}} o base = href prefix from this page to the milestone root */
  function create(o) {
    var index = o.index;
    var base = o.base || '';
    var pages = {};
    index.pages.forEach(function (p) { pages[p.id] = p; });
    var entities = {};
    index.entities.forEach(function (e) { entities[e.id] = e; });
    var pageUrl = root.RedocsQuery ? root.RedocsQuery.pageUrl : function (id, a) { return id + '.html' + (a ? '#' + encodeURIComponent(a) : ''); };

    function link(target, ref, label) {
      return '<a class="rd-chat__ref" href="' + escapeText(base + target) + '" title="' + ref + '">' + escapeText(label) + '</a>';
    }
    function bad(ref, why) {
      return '<span class="rd-chat__badref" title="' + why + '">' + ref + '</span>';
    }
    var PAGE_REF = /page:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?:#([a-z0-9][a-z0-9-]*))?/g;
    var ENTITY_REF = /entity:([a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*)/g;
    /** page:/entity: ref -> {url, label} relative to the milestone root, or null when it does not exist. */
    function resolvePage(id, anchor) {
      var p = pages[id];
      if (!(p && p.exists && (!anchor || p.anchors.indexOf(anchor) >= 0))) return null;
      var section = anchor ? p.sections.filter(function (s) { return s.anchor === anchor; })[0] : null;
      return { url: pageUrl(id, anchor), label: p.title + (anchor ? ' › ' + (section && section.title ? section.title : anchor) : '') };
    }
    function resolveEntity(id) {
      var e = entities[id];
      return e ? { url: e.url, label: e.name } : null;
    }
    function resolveRef(ref) {
      var m = /^page:([^#]+)(?:#(.+))?$/.exec(ref);
      if (m) return resolvePage(m[1], m[2]);
      m = /^entity:(.+)$/.exec(ref);
      return m ? resolveEntity(m[1]) : null;
    }
    // Input is already escaped; ref characters ([a-z0-9-/:#]) are unaffected by escaping.
    function linkRefs(html) {
      return html
        .replace(PAGE_REF, function (ref, id, anchor) {
          var r = resolvePage(id, anchor);
          return r ? link(r.url, ref, r.label) : bad(ref, 'Not found in this book');
        })
        .replace(ENTITY_REF, function (ref, id) {
          var r = resolveEntity(id);
          return r ? link(r.url, ref, r.label) : bad(ref, 'Not registered in this book');
        });
    }

    // Full CommonMark + GFM tables via the vendored markdown-it (same parser the book pages use).
    // Raw HTML stays escaped (html:false), images are disabled so an answer can never make the
    // browser load a remote URL, and page:/entity: refs are linked inside text and inline code.
    var md = null;
    var markdownit = 'markdownit' in o ? o.markdownit : root.markdownit;
    if (typeof markdownit === 'function') {
      md = markdownit({ html: false, linkify: false, breaks: true, typographer: false });
      md.disable(['image']);
      var rules = md.renderer.rules;
      rules.text = function (tokens, i) { return linkRefs(escapeText(tokens[i].content)); };
      rules.code_inline = function (tokens, i) {
        var code = tokens[i].content;
        return /^(page|entity):/.test(code) ? linkRefs(escapeText(code)) : '<code>' + escapeText(code) + '</code>';
      };
      rules.fence = rules.code_block = function (tokens, i) { return '<pre><code>' + escapeText(tokens[i].content) + '</code></pre>\n'; };
      rules.table_open = function () { return '<div class="rd-chat__table"><table>\n'; };
      rules.table_close = function () { return '</table></div>\n'; };
      rules.link_open = function (tokens, i, opts, env, self) {
        var t = tokens[i];
        var href = t.attrGet('href') || '';
        if (/^(page|entity):/.test(href)) {
          var r = resolveRef(href);
          if (r) { t.attrSet('href', base + r.url); t.attrSet('class', 'rd-chat__ref'); t.attrSet('title', href); }
          else { t.attrSet('href', '#'); t.attrSet('class', 'rd-chat__badref'); t.attrSet('title', 'Not found in this book'); }
        } else if (/^https?:/i.test(href)) {
          t.attrSet('target', '_blank');
          t.attrSet('rel', 'noopener noreferrer');
        }
        return self.renderToken(tokens, i, opts);
      };
    }
    function inline(text) {
      return escapeText(text).split(/(`[^`]+`)/g).map(function (part) {
        if (/^`[^`]+`$/.test(part)) {
          var code = part.slice(1, -1);
          return /^(page|entity):/.test(code) ? linkRefs(code) : '<code>' + code + '</code>';
        }
        return linkRefs(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      }).join('');
    }
    function markdown(text) {
      if (md) return md.render(String(text || ''));
      return basicMarkdown(text);
    }
    // Fallback when the markdown-it script failed to load: paragraphs, lists, fences, headings.
    function basicMarkdown(text) {
      var out = [];
      String(text || '').split(/```/).forEach(function (chunk, i) {
        if (i % 2 === 1) {
          // An unclosed fence while streaming still renders as code.
          out.push('<pre><code>' + escapeText(chunk.replace(/^[a-z0-9-]*\n/i, '')) + '</code></pre>');
          return;
        }
        chunk.split(/\n\s*\n/).forEach(function (block) {
          var lines = block.split('\n').filter(function (l) { return l.trim(); });
          if (!lines.length) return;
          if (lines.every(function (l) { return /^\s*([-*]|\d+\.)\s+/.test(l); })) {
            var tag = /^\s*\d+\./.test(lines[0]) ? 'ol' : 'ul';
            out.push('<' + tag + '>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*([-*]|\d+\.)\s+/, '')) + '</li>'; }).join('') + '</' + tag + '>');
          } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) {
            out.push('<p class="rd-chat__h"><strong>' + inline(lines[0].replace(/^#+\s*/, '')) + '</strong></p>');
          } else {
            out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
          }
        });
      });
      return out.join('');
    }

    /** One stored turn {role, text, steps?, invalid?, meta?} -> message HTML (without wrapper). */
    function turn(t) {
      if (t.role === 'user') return '<p>' + escapeText(t.text).replace(/\n/g, '<br>') + '</p>';
      if (t.role === 'assistant') {
        var html = '';
        if (t.steps && t.steps.length) {
          html += '<details class="rd-chat__steps"><summary>' + t.steps.length + ' step(s) in the book</summary><ol>'
            + t.steps.map(function (s) { return '<li>' + escapeText(s) + '</li>'; }).join('') + '</ol></details>';
        }
        html += markdown(t.text || '(No answer.)');
        if (t.invalid) html += '<p class="rd-chat__warn">' + t.invalid + ' cited reference(s) do not exist in this book.</p>';
        if (t.meta) html += '<p class="rd-chat__meta">' + escapeText(t.meta) + '</p>';
        return html;
      }
      return '<p>' + escapeText(t.text) + '</p>';
    }

    return { escapeText: escapeText, markdown: markdown, turn: turn };
  }

  root.RedocsChatRender = { create: create, escapeText: escapeText };
}(typeof globalThis !== 'undefined' ? globalThis : this));
