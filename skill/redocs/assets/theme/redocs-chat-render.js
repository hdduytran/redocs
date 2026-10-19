/* ReDocs chat rendering: model text -> safe HTML. Everything is escaped first; then a small
 * Markdown subset (paragraphs, lists, fenced code, headings, inline code, bold) and page:/entity:
 * refs as links into the book (unknown refs are struck through). No DOM: returns strings, so the
 * same code renders live answers, restored conversations and Node tests. */
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
    // Input is already escaped; ref characters ([a-z0-9-/:#]) are unaffected by escaping.
    function linkRefs(html) {
      return html
        .replace(/page:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)(?:#([a-z0-9][a-z0-9-]*))?/g, function (ref, id, anchor) {
          var p = pages[id];
          if (!(p && p.exists && (!anchor || p.anchors.indexOf(anchor) >= 0))) return bad(ref, 'Not found in this book');
          var section = anchor ? p.sections.filter(function (s) { return s.anchor === anchor; })[0] : null;
          return link(pageUrl(id, anchor), ref, p.title + (anchor ? ' › ' + (section && section.title ? section.title : anchor) : ''));
        })
        .replace(/entity:([a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*)/g, function (ref, id) {
          var e = entities[id];
          return e ? link(e.url, ref, e.name) : bad(ref, 'Not registered in this book');
        });
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
