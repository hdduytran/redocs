/* ReDocs runtime. Works over file://: no network requests; data comes from <script src="search-index.js">. */
(function () {
  'use strict';
  var doc = document.documentElement;

  // Embedded mode for compare columns: hide chrome and report height to the parent frame.
  var embedded = /(?:^|[?&])embed=1(?:&|$)/.test(location.search) && window.parent !== window;
  if (embedded) {
    doc.classList.add('rd-embedded');
    var report = function () {
      try { parent.postMessage({ type: 'redocs:height', h: Math.ceil(doc.scrollHeight) }, '*'); } catch (e) { /* ignore */ }
    };
    if (window.ResizeObserver) new ResizeObserver(report).observe(doc);
    window.addEventListener('load', report);
    report();
  }

  // Theme toggle; preference persists when localStorage is available.
  var themeButton = document.querySelector('.rd-theme');
  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var dark = doc.dataset.theme ? doc.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      doc.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('redocs-theme', doc.dataset.theme); } catch (e) { /* file:// may block storage */ }
    });
  }

  // Mobile navigation.
  var menu = document.querySelector('.rd-menu');
  var nav = document.getElementById('rd-nav');
  if (menu && nav) {
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
    });
  }

  // Copy for AI: a split button. Works over file:// using navigator.clipboard (write needs a
  // user gesture, which a click is) with a textarea+execCommand fallback. Data comes from two
  // inline blocks the builder wrote: #rd-copy-meta (JSON) and #rd-copy-source (verbatim source).
  (function () {
    var toolbar = document.querySelector('[data-rd-copy]');
    if (!toolbar) return;
    var metaEl = document.getElementById('rd-copy-meta');
    var sourceEl = document.getElementById('rd-copy-source');
    var meta = {};
    try { meta = JSON.parse(metaEl ? metaEl.textContent : '{}'); } catch (e) { meta = {}; }
    var source = sourceEl ? sourceEl.textContent : '';
    var status = toolbar.querySelector('.rd-copy__status');
    var toggle = toolbar.querySelector('.rd-copy__toggle');
    var menuEl = toolbar.querySelector('.rd-copy__menu');
    toolbar.hidden = false; // only shown once JS can actually copy

    function deepLink() {
      // Strip any existing hash; keep the current section if the reader scrolled to one.
      return location.href;
    }
    function build(action) {
      var ref = meta.pageRef || '';
      var title = meta.title || document.title;
      switch (action) {
        case 'path': return ref;
        case 'content': return source;
        case 'citation': return '[' + title + '](' + ref + ') · ' + (meta.milestone || '');
        case 'deep-link': return deepLink();
        case 'ai-context':
          return [
            '--- redocs-context ---',
            'page: ' + ref,
            'title: ' + title,
            'book: ' + (meta.bookTitle || ''),
            'milestone: ' + (meta.milestone || ''),
            'kind: ' + (meta.kind || ''),
            'entities: ' + ((meta.entities || []).join(', ') || '(none)'),
            'format: ' + (meta.sourceFormat || 'none'),
            'url: ' + deepLink(),
            '--- content ---',
            source,
          ].join('\n');
        case 'path-content':
        default:
          return '# ' + ref + '\n\n' + source;
      }
    }
    function flash(msg) {
      if (!status) return;
      status.textContent = msg;
      clearTimeout(flash._t);
      flash._t = setTimeout(function () { status.textContent = ''; }, 2000);
    }
    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash('Copied'); }, fallback);
      } else {
        fallback();
      }
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'absolute';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          flash('Copied');
        } catch (e) {
          flash('Press Ctrl/Cmd+C');
        }
      }
    }
    function openMenu(open) {
      menuEl.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    }
    toolbar.addEventListener('click', function (event) {
      var actionEl = event.target.closest('[data-rd-copy-action]');
      if (actionEl) { copy(build(actionEl.getAttribute('data-rd-copy-action'))); openMenu(false); return; }
      if (event.target === toggle || toggle.contains(event.target)) { openMenu(menuEl.hidden); }
    });
    document.addEventListener('click', function (event) {
      if (!toolbar.contains(event.target)) openMenu(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menuEl.hidden) { openMenu(false); toggle.focus(); }
    });
  }());

  // Size iframes from the height their document reports (artifacts, standalone pages, compare).
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'redocs:height' || typeof data.h !== 'number') return;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].contentWindow !== event.source) continue;
      var max = Number(frames[i].getAttribute('data-max-height')) || 4000;
      frames[i].style.height = Math.max(200, Math.min(data.h + 4, max)) + 'px';
    }
  });

  // Search over window.__REDOCS_SEARCH = [{t: title, u: url, k: kind, h: [headings], x: text}].
  var input = document.getElementById('rd-search-input');
  var results = document.getElementById('rd-search-results');
  var index = window.__REDOCS_SEARCH || [];
  if (!input || !results) return;
  var base = input.getAttribute('data-base') || '';

  function escapeText(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fold(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  }
  var prepared = index.map(function (d) {
    return { d: d, t: fold(d.t), h: fold((d.h || []).join(' ')), x: fold(d.x) };
  });

  function snippet(text, term) {
    var at = fold(text).indexOf(term);
    if (at < 0) return '';
    var start = Math.max(0, at - 50);
    return (start > 0 ? '…' : '') + text.slice(start, at + term.length + 70) + '…';
  }

  function run() {
    var terms = fold(input.value).split(/\s+/).filter(Boolean);
    if (!terms.length) { results.hidden = true; results.innerHTML = ''; return; }
    var scored = [];
    prepared.forEach(function (p) {
      var score = 0;
      for (var i = 0; i < terms.length; i += 1) {
        var term = terms[i];
        var s = (p.t.indexOf(term) >= 0 ? 10 : 0) + (p.h.indexOf(term) >= 0 ? 4 : 0) + (p.x.indexOf(term) >= 0 ? 1 : 0);
        if (!s) return; // every term must match somewhere
        score += s;
      }
      scored.push({ p: p, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.p.d.t.localeCompare(b.p.d.t); });
    var top = scored.slice(0, 12);
    results.innerHTML = top.length
      ? top.map(function (r) {
        return '<li role="option"><a href="' + escapeText(base + r.p.d.u) + '">' + escapeText(r.p.d.t)
          + '<small>' + escapeText(r.p.d.k || '') + ' ' + escapeText(snippet(r.p.d.x || '', terms[0])) + '</small></a></li>';
      }).join('')
      : '<li class="rd-muted" role="option" aria-disabled="true">No results</li>';
    results.hidden = false;
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { results.hidden = true; input.blur(); }
    if (event.key === 'ArrowDown') {
      var first = results.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Enter') {
      var link = results.querySelector('a');
      if (link) location.href = link.href;
    }
  });
  results.addEventListener('keydown', function (event) {
    var links = Array.prototype.slice.call(results.querySelectorAll('a'));
    var i = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && i < links.length - 1) { event.preventDefault(); links[i + 1].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (i > 0 ? links[i - 1] : input).focus(); }
    if (event.key === 'Escape') { results.hidden = true; input.focus(); }
  });
  document.addEventListener('click', function (event) {
    if (!results.contains(event.target) && event.target !== input) results.hidden = true;
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === '/' && document.activeElement === document.body) { event.preventDefault(); input.focus(); }
  });
}());
