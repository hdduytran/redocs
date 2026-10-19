/* ReDocs chat history: conversations kept in this browser only (localStorage, per book).
 * Each conversation stores what the reader saw (`turns`) and the model's native history
 * (`messages`) so it can be resumed. Bounded: newest 50 conversations and ~3 MB; when over
 * budget the oldest go first, and a conversation that is still too big keeps its turns but
 * drops `messages` (resuming it starts a fresh model context). Storage is injected, so Node
 * tests run it with a fake. */
(function (root) {
  'use strict';

  var VERSION = 1;
  var MAX_CONVERSATIONS = 50;
  var MAX_CHARS = 3000000;
  var TITLE_CHARS = 80;

  function titleOf(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > TITLE_CHARS ? t.slice(0, TITLE_CHARS - 1) + '…' : t || 'Untitled';
  }

  function newId(now) {
    return 'c' + Number(now).toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * @param {{getItem: Function, setItem: Function, removeItem: Function}|null} storage
   * @param {string} bookId
   * @param {{now?: () => number, maxConversations?: number, maxChars?: number}} [options]
   */
  function create(storage, bookId, options) {
    var o = options || {};
    var now = o.now || function () { return Date.now(); };
    var maxConversations = o.maxConversations || MAX_CONVERSATIONS;
    var maxChars = o.maxChars || MAX_CHARS;
    var key = 'redocs-chat-history:' + bookId;
    var memory = null; // used when storage is missing or refuses writes

    function readAll() {
      if (memory) return memory.slice();
      var raw = null;
      try { raw = storage ? storage.getItem(key) : null; } catch (e) { raw = null; }
      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
      return parsed && parsed.v === VERSION && Array.isArray(parsed.conversations) ? parsed.conversations : [];
    }

    function writeAll(list) {
      var sorted = list.slice().sort(function (a, b) { return b.updated - a.updated; }).slice(0, maxConversations);
      var text = JSON.stringify({ v: VERSION, conversations: sorted });
      while (text.length > maxChars && sorted.length > 1) {
        sorted.pop();
        text = JSON.stringify({ v: VERSION, conversations: sorted });
      }
      if (text.length > maxChars && sorted.length === 1 && sorted[0].messages && sorted[0].messages.length) {
        sorted[0] = Object.assign({}, sorted[0], { messages: [], trimmed: true });
        text = JSON.stringify({ v: VERSION, conversations: sorted });
      }
      try {
        if (!storage) throw new Error('no storage');
        storage.setItem(key, text);
        memory = null;
      } catch (e) {
        memory = sorted; // quota or blocked: keep this tab working
      }
      return sorted;
    }

    function summary(c) {
      var users = (c.turns || []).filter(function (t) { return t.role === 'user'; }).length;
      return { id: c.id, title: c.title, created: c.created, updated: c.updated, milestone: c.milestone, model: c.model, questions: users, trimmed: Boolean(c.trimmed) };
    }

    return {
      key: key,
      /** Newest first; `filter` matches title and turn text, accent-insensitively when RedocsQuery is loaded. */
      list: function (filter) {
        var fold = root.RedocsQuery ? root.RedocsQuery.fold : function (s) { return String(s || '').toLowerCase(); };
        var f = fold(String(filter || '').trim());
        return readAll()
          .filter(function (c) {
            if (!f) return true;
            return fold(c.title).indexOf(f) >= 0 || (c.turns || []).some(function (t) { return fold(t.text).indexOf(f) >= 0; });
          })
          .sort(function (a, b) { return b.updated - a.updated; })
          .map(summary);
      },
      get: function (id) {
        return readAll().filter(function (c) { return c.id === id; })[0] || null;
      },
      /** Insert or update; stamps `updated` (and `created`, `title` for a new one). Returns the stored copy. */
      put: function (conversation) {
        var list = readAll();
        var t = now();
        var c = Object.assign({}, conversation);
        c.updated = t;
        if (!c.created) c.created = t;
        if (!c.title) {
          var first = (c.turns || []).filter(function (x) { return x.role === 'user'; })[0];
          c.title = titleOf(first ? first.text : '');
        }
        var at = -1;
        for (var i = 0; i < list.length; i += 1) if (list[i].id === c.id) at = i;
        if (at >= 0) list[at] = c; else list.push(c);
        var stored = writeAll(list);
        return stored.filter(function (x) { return x.id === c.id; })[0] || null;
      },
      remove: function (id) {
        writeAll(readAll().filter(function (c) { return c.id !== id; }));
      },
      clear: function () {
        memory = null;
        try { if (storage) storage.removeItem(key); } catch (e) { memory = []; }
      },
    };
  }

  root.RedocsChatStore = { create: create, titleOf: titleOf, newId: newId };
}(typeof globalThis !== 'undefined' ? globalThis : this));
