/* ReDocs "Ask AI" panel (book.json chat.enabled): UI only.
 *   tools      RedocsQuery over window.__REDOCS_AGENT_INDEX
 *   tool loop  RedocsChatAgent (the only network code), streaming via RedocsChatStream
 *   history    RedocsChatStore (localStorage, this browser only)
 *   rendering  RedocsChatRender (escaped Markdown subset, page:/entity: links)
 * On wide screens the panel docks right and pushes the page left; its width is resizable and
 * remembered. The open state, current conversation id and draft follow the reader across pages
 * (sessionStorage, per tab). */
(function () {
  'use strict';
  var doc = document.documentElement;
  var index = window.__REDOCS_AGENT_INDEX;
  var Agent = window.RedocsChatAgent;
  var Store = window.RedocsChatStore;
  var Render = window.RedocsChatRender;
  var toggle = document.querySelector('.rd-chat-toggle');
  var panel = document.getElementById('rd-chat');
  var configEl = document.getElementById('rd-chat-config');
  if (!index || !Agent || !Store || !Render || !window.RedocsQuery || !toggle || !panel || !configEl || doc.classList.contains('rd-embedded')) {
    doc.classList.remove('rd-chat-open'); // the <head> script may have reserved room for the panel
    return;
  }

  var config = {};
  try { config = JSON.parse(configEl.textContent || '{}'); } catch (e) { config = {}; }
  var base = config.base || '';
  var SETTINGS_KEY = 'redocs-chat-settings';
  var KEY_PREFIX = 'redocs-chat-key:';
  var STATE_KEY = 'redocs-chat-state:' + index.book.id;
  var WIDTH_KEY = 'redocs-chat-width';

  var $ = function (sel) { return panel.querySelector(sel); };
  var log = $('.rd-chat__log');
  var form = $('.rd-chat__form');
  var input = $('#rd-chat-input');
  var send = $('.rd-chat__send');
  var stop = $('.rd-chat__stop');
  var privacy = $('.rd-chat__privacy');
  var details = $('.rd-chat__settings');
  var statusEl = $('.rd-chat__status');
  var statusText = $('.rd-chat__status-text');
  var elapsedEl = $('.rd-chat__elapsed');
  var historyBtn = $('.rd-chat__history-btn');
  var historySection = $('.rd-chat__history');
  var historyList = $('.rd-chat__history-list');
  var historyFilter = $('#rd-chat-history-filter');
  var expandBtn = $('.rd-chat__expand');
  var resizer = $('.rd-chat__resize');
  var fields = {
    provider: $('[name="provider"]'),
    endpoint: $('[name="endpoint"]'),
    model: $('[name="model"]'),
    key: $('[name="key"]'),
    remember: $('[name="remember"]'),
    stream: $('[name="stream"]'),
  };

  // ---- storage ------------------------------------------------------------------------------------

  function store(kind) {
    try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function getItem(kind, key) { var s = store(kind); try { return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function setItem(kind, key, value) {
    var s = store(kind);
    try { if (s) { if (value) s.setItem(key, value); else s.removeItem(key); } } catch (e) { /* file:// may block storage */ }
  }

  var history = Store.create(store('local'), index.book.id);
  var R = Render.create({ index: index, base: base });
  var escapeText = R.escapeText;

  // ---- settings and model list ---------------------------------------------------------------

  var saved = {};
  try { saved = JSON.parse(getItem('local', SETTINGS_KEY) || '{}'); } catch (e) { saved = {}; }

  function settings() {
    return Agent.resolveSettings(config.chat, { provider: fields.provider.value, endpoint: fields.endpoint.value.trim(), model: fields.model.value.trim(), stream: fields.stream.checked });
  }
  function keyFor(provider) {
    return getItem('session', KEY_PREFIX + provider) || getItem('local', KEY_PREFIX + provider) || '';
  }
  function hostOf(url) {
    var m = /^https?:\/\/([^/]+)/i.exec(url || '');
    return m ? m[1] : url;
  }

  // Fetched only on a reader action (endpoint/key/provider change, ↻), never on page load, and
  // remembered with the settings so every page shows the same choices without a request.
  var modelsStatus = $('.rd-chat__models-status');
  var refresh = $('.rd-chat__models-refresh');
  var modelList = [];
  var modelsRequest = 0;

  function setModelOptions(models, selected) {
    modelList = models || [];
    var ids = modelList.map(function (m) { return m.id; });
    var choice = selected && (ids.indexOf(selected) >= 0 || !ids.length) ? selected : ids[0] || selected || '';
    var options = modelList.slice();
    if (choice && ids.indexOf(choice) < 0) options.unshift({ id: choice, label: choice + (ids.length ? ' (not listed)' : '') });
    fields.model.innerHTML = options.map(function (m) {
      return '<option value="' + escapeText(m.id) + '">' + escapeText(m.label === m.id ? m.id : m.label + ' — ' + m.id) + '</option>';
    }).join('');
    fields.model.value = choice;
  }

  async function loadModels() {
    var s = settings();
    var apiKey = fields.key.value.trim();
    var ticket = ++modelsRequest;
    if (s.provider === 'anthropic' && !apiKey) {
      modelsStatus.textContent = 'Enter the API key to list models.';
      return;
    }
    modelsStatus.textContent = 'Loading models from ' + hostOf(s.endpoint) + '…';
    refresh.disabled = true;
    try {
      var models = await Agent.listModels({ settings: s, apiKey: apiKey });
      if (ticket !== modelsRequest) return; // a newer endpoint/key was entered meanwhile
      setModelOptions(models, fields.model.value);
      modelsStatus.textContent = models.length ? models.length + ' model(s) on ' + hostOf(s.endpoint) + '.' : 'The endpoint lists no models.';
      persist();
    } catch (error) {
      if (ticket !== modelsRequest) return;
      modelsStatus.textContent = 'Could not list models: ' + (error && error.message ? error.message : String(error))
        + (isNetworkError(error) ? ' (unreachable, or the server does not allow this page\'s origin)' : '');
    } finally {
      if (ticket === modelsRequest) refresh.disabled = false;
    }
  }

  function fillFields(provider) {
    var same = provider === saved.provider;
    var s = Agent.resolveSettings(config.chat, same ? saved : { provider: provider });
    fields.provider.value = s.provider;
    fields.endpoint.value = s.endpoint;
    setModelOptions(same && saved.endpoint === s.endpoint && Array.isArray(saved.models) ? saved.models : [], s.model);
    modelsStatus.textContent = modelList.length ? modelList.length + ' model(s) on ' + hostOf(s.endpoint) + '.' : 'Press ↻ to load models from the endpoint.';
    fields.key.value = keyFor(s.provider);
    fields.remember.checked = Boolean(getItem('local', KEY_PREFIX + s.provider));
    fields.stream.checked = saved.stream !== undefined ? saved.stream !== false : s.stream;
    updatePrivacy();
  }
  function persist() {
    var s = settings();
    saved = { provider: s.provider, endpoint: s.endpoint, model: fields.model.value.trim(), models: modelList, stream: fields.stream.checked };
    setItem('local', SETTINGS_KEY, JSON.stringify(saved));
    var key = fields.key.value.trim();
    setItem('session', KEY_PREFIX + s.provider, key);
    setItem('local', KEY_PREFIX + s.provider, fields.remember.checked ? key : '');
    updatePrivacy();
  }
  function updatePrivacy() {
    privacy.textContent = 'Your question and the book sections the model reads are sent to ' + hostOf(settings().endpoint)
      + ' when you press Send; the model list is fetched when you set the endpoint or press ↻. Nothing is sent before that.';
  }
  function isNetworkError(error) {
    return /Failed to fetch|NetworkError|Load failed/i.test(String(error && error.message));
  }

  // ---- docked layout: width, resize, expand ---------------------------------------------------

  var MIN_WIDTH = 320;
  var DEFAULT_WIDTH = 480;
  var width = Number(getItem('local', WIDTH_KEY)) || DEFAULT_WIDTH;
  var normalWidth = width;

  function maxWidth() { return Math.max(MIN_WIDTH, Math.min(1000, Math.round(window.innerWidth * 0.65))); }
  function setWidth(px, save) {
    width = Math.max(MIN_WIDTH, Math.min(maxWidth(), Math.round(px)));
    doc.style.setProperty('--rd-chat-width', width + 'px');
    resizer.setAttribute('aria-valuenow', String(width));
    resizer.setAttribute('aria-valuemin', String(MIN_WIDTH));
    resizer.setAttribute('aria-valuemax', String(maxWidth()));
    var wide = width >= maxWidth() - 8;
    expandBtn.setAttribute('aria-pressed', String(wide));
    expandBtn.setAttribute('aria-label', wide ? 'Narrow chat panel' : 'Widen chat panel');
    if (save) {
      setItem('local', WIDTH_KEY, String(width));
      if (!wide) normalWidth = width;
    }
  }
  resizer.addEventListener('pointerdown', function (event) {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    doc.classList.add('rd-chat-resizing');
    function move(e) { setWidth(window.innerWidth - e.clientX, false); }
    function up(e) {
      resizer.releasePointerCapture(e.pointerId);
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      doc.classList.remove('rd-chat-resizing');
      setWidth(width, true);
    }
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });
  resizer.addEventListener('keydown', function (event) {
    var step = event.shiftKey ? 96 : 32;
    if (event.key === 'ArrowLeft') setWidth(width + step, true);
    else if (event.key === 'ArrowRight') setWidth(width - step, true);
    else return;
    event.preventDefault();
  });
  expandBtn.addEventListener('click', function () {
    var wide = expandBtn.getAttribute('aria-pressed') === 'true';
    setWidth(wide ? (normalWidth < maxWidth() - 8 ? normalWidth : DEFAULT_WIDTH) : maxWidth(), true);
  });
  window.addEventListener('resize', function () { setWidth(width, false); });

  // ---- conversation ---------------------------------------------------------------------------

  var current = null; // {id, title, created, updated, milestone, provider, model, messages, turns}
  var running = null;

  function newConversation() {
    return { id: Store.newId(Date.now()), turns: [], messages: [], provider: null, model: null, milestone: index.milestone.id };
  }
  function hasQuestions(c) {
    return c && c.turns.some(function (t) { return t.role === 'user'; });
  }
  function saveCurrent() {
    if (hasQuestions(current)) current = history.put(current) || current;
  }

  function messageEl(role, html) {
    var el = document.createElement('div');
    el.className = 'rd-chat__msg rd-chat__msg--' + role;
    el.innerHTML = html;
    return el;
  }
  function scrollToEnd() { log.scrollTop = log.scrollHeight; }
  function introHtml() {
    var html = '<p>Ask about <strong>' + escapeText(index.book.title) + '</strong> at milestone <strong>' + escapeText(index.milestone.label)
      + '</strong>. Answers cite the pages they come from.</p>';
    if (current.milestone && current.milestone !== index.milestone.id && current.turns.length) {
      html += '<p>This conversation started at milestone <strong>' + escapeText(current.milestone) + '</strong>; new answers use <strong>' + escapeText(index.milestone.id) + '</strong>.</p>';
    }
    return html;
  }
  function renderLog() {
    log.innerHTML = '';
    log.appendChild(messageEl('note', introHtml()));
    current.turns.forEach(function (t) { log.appendChild(messageEl(t.role, R.turn(t))); });
    scrollToEnd();
  }
  function addTurn(t) {
    current.turns.push(t);
    log.appendChild(messageEl(t.role, R.turn(t)));
    scrollToEnd();
  }

  // ---- session state (follows the reader across pages in this tab) ----------------------------

  var view = 'chat';
  function saveSession(pending) {
    setItem('session', STATE_KEY, JSON.stringify({ v: 2, open: !panel.hidden, view: view, currentId: current && current.id, draft: input.value, pending: Boolean(pending) }));
  }
  function restoreSession() {
    var state = null;
    try { state = JSON.parse(getItem('session', STATE_KEY) || 'null'); } catch (e) { state = null; }
    if (!state || state.v !== 2) return { open: false, view: 'chat' };
    current = (state.currentId && history.get(state.currentId)) || null;
    if (current) {
      current.turns = current.turns || [];
      current.messages = current.messages || [];
    }
    input.value = state.draft || '';
    if (state.pending && current) {
      current.turns.push({ role: 'note', text: 'The previous question was interrupted when the page changed. Ask it again.' });
      saveCurrent();
    }
    return { open: Boolean(state.open), view: state.view === 'history' ? 'history' : 'chat' };
  }

  // ---- waiting indicator ------------------------------------------------------------------------

  var startedAt = 0;
  var ticker = null;
  function showStatus(text) {
    statusText.textContent = text;
    if (!statusEl.hidden) return;
    statusEl.hidden = false;
    startedAt = Date.now();
    elapsedEl.textContent = '';
    ticker = setInterval(function () {
      var s = Math.round((Date.now() - startedAt) / 1000);
      elapsedEl.textContent = s >= 1 ? s + 's' : '';
    }, 500);
  }
  function hideStatus() {
    statusEl.hidden = true;
    clearInterval(ticker);
    ticker = null;
  }
  function describeTool(name, input) {
    var arg = input && (input.query || input.ref || input.page || input.id || input.chapter || (input.from ? input.from + '→' + (input.to || '') : ''));
    var verbs = { book_map: 'Reading the table of contents', book_outline: 'Outlining', book_search: 'Searching', book_read: 'Reading', book_entity: 'Looking up', book_changes: 'Comparing milestones', book_citations: 'Checking citations' };
    return (verbs[name] || name) + (arg ? ': ' + arg : '');
  }

  // ---- asking -----------------------------------------------------------------------------------

  function setBusy(busy) {
    send.disabled = busy;
    stop.hidden = !busy;
    input.disabled = busy;
    panel.classList.toggle('is-busy', busy);
  }

  async function ask(question) {
    var s = settings();
    var apiKey = fields.key.value.trim();
    if (s.provider === 'anthropic' && !apiKey) {
      details.open = true;
      fields.key.focus();
      addTurn({ role: 'error', text: 'Enter an API key in Model settings first.' });
      return;
    }
    if (current.provider && current.provider !== s.provider) current.messages = []; // native shapes differ
    current.provider = s.provider;
    current.model = s.model;
    addTurn({ role: 'user', text: question });
    saveCurrent();
    var steps = [];
    var live = null;      // the streaming answer bubble
    var liveText = '';
    var liveRound = -1;
    var frame = 0;
    var activity = null;  // live list of steps taken in the book
    function paintLive() {
      frame = 0;
      if (!live) {
        live = messageEl('assistant', '');
        live.classList.add('is-streaming');
        log.appendChild(live);
      }
      live.innerHTML = R.markdown(liveText);
      scrollToEnd();
    }
    function dropLive() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (live) live.remove();
      live = null;
      liveText = '';
    }
    running = new AbortController();
    var began = Date.now();
    setBusy(true);
    saveSession(true);
    showStatus('Waiting for ' + (s.model || 'the model') + '…');
    try {
      var result = await Agent.runTurn({
        index: index,
        settings: s,
        apiKey: apiKey,
        messages: current.messages,
        question: question,
        page: config.page || '',
        signal: running.signal,
        onEvent: function (event) {
          if (event.type === 'request') {
            showStatus(event.round === 0 ? 'Waiting for ' + (s.model || 'the model') + '…' : 'Thinking about what it read…');
          } else if (event.type === 'delta') {
            if (event.round !== liveRound) { dropLive(); liveRound = event.round; }
            liveText += event.text;
            showStatus('Writing…');
            if (!frame) frame = requestAnimationFrame(paintLive);
          } else if (event.type === 'round' && event.tools) {
            dropLive(); // text before tool calls is the model thinking aloud, not the answer
          } else if (event.type === 'tool') {
            steps.push(describeTool(event.name, event.input));
            showStatus(steps[steps.length - 1] + '…');
            if (!activity) { activity = messageEl('activity', ''); log.appendChild(activity); }
            activity.innerHTML = '<ol class="rd-chat__live-steps">' + steps.map(function (x) { return '<li>' + escapeText(x) + '</li>'; }).join('') + '</ol>';
            scrollToEnd();
          }
        },
      });
      dropLive();
      if (activity) activity.remove();
      current.messages = result.messages;
      addTurn({
        role: 'assistant',
        text: result.answer || '',
        steps: steps,
        invalid: result.citations.invalid || 0,
        meta: (s.model || s.provider) + ' · ' + Math.max(1, Math.round((Date.now() - began) / 1000)) + 's',
      });
    } catch (error) {
      var partial = liveText;
      dropLive();
      if (activity) activity.remove();
      if (error && error.name === 'AbortError') {
        if (partial) addTurn({ role: 'assistant', text: partial, steps: steps, meta: 'stopped' });
        addTurn({ role: 'note', text: 'Stopped.' });
      } else {
        addTurn({ role: 'error', text: (error && error.message ? error.message : String(error))
          + (isNetworkError(error) ? ' — The endpoint could not be reached from this page. A model server must allow this page\'s origin (vLLM: --allowed-origins, Ollama: OLLAMA_ORIGINS).' : '') });
      }
    } finally {
      running = null;
      hideStatus();
      setBusy(false);
      saveCurrent();
      saveSession(false);
      input.focus();
    }
  }

  // ---- history view -----------------------------------------------------------------------------

  function formatDate(ts) {
    try { return new Date(ts).toLocaleString(index.book.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(ts).toISOString(); }
  }
  function renderHistory() {
    var items = history.list(historyFilter.value);
    historyList.innerHTML = items.length
      ? items.map(function (c) {
        var meta = [formatDate(c.updated), c.milestone, c.questions + ' question(s)', c.model].filter(Boolean).join(' · ');
        var isCurrent = current && c.id === current.id;
        return '<li class="rd-chat__history-item' + (isCurrent ? ' is-current' : '') + '">'
          + '<button type="button" class="rd-chat__history-open" data-id="' + escapeText(c.id) + '"' + (isCurrent ? ' aria-current="true"' : '') + '>'
          + '<span class="rd-chat__history-title">' + escapeText(c.title) + '</span><span class="rd-chat__history-meta">' + escapeText(meta) + '</span></button>'
          + '<button type="button" class="rd-chat__history-delete" data-id="' + escapeText(c.id) + '" aria-label="Delete conversation: ' + escapeText(c.title) + '" title="Delete">×</button></li>';
      }).join('')
      : '<li class="rd-chat__history-empty rd-muted">' + (historyFilter.value ? 'No conversation matches.' : 'No saved conversations yet.') + '</li>';
  }
  function showHistory(on) {
    view = on ? 'history' : 'chat';
    historySection.hidden = !on;
    log.hidden = on;
    form.hidden = on;
    historyBtn.setAttribute('aria-pressed', String(on));
    historyBtn.textContent = on ? 'Back to chat' : 'History';
    if (on) { renderHistory(); historyFilter.focus(); } else { scrollToEnd(); }
    saveSession(Boolean(running));
  }
  historyBtn.addEventListener('click', function () { showHistory(view !== 'history'); });
  historyFilter.addEventListener('input', renderHistory);
  historyList.addEventListener('click', function (event) {
    var target = event.target.closest('button[data-id]');
    if (!target) return;
    var id = target.getAttribute('data-id');
    if (target.classList.contains('rd-chat__history-delete')) {
      history.remove(id);
      if (current && current.id === id) { current = newConversation(); renderLog(); }
      renderHistory();
      saveSession(false);
      return;
    }
    if (running) running.abort();
    var c = history.get(id);
    if (!c) { renderHistory(); return; }
    current = c;
    current.turns = current.turns || [];
    current.messages = current.messages || [];
    renderLog();
    showHistory(false);
    input.focus();
  });
  $('.rd-chat__history-clear').addEventListener('click', function () {
    if (!history.list().length) return;
    if (!window.confirm('Delete all saved conversations for this book? This cannot be undone.')) return;
    history.clear();
    current = newConversation();
    renderLog();
    renderHistory();
    saveSession(false);
  });

  // ---- open / close / wiring ------------------------------------------------------------------

  function open(show, restoring) {
    panel.hidden = !show;
    toggle.setAttribute('aria-expanded', String(show));
    doc.classList.toggle('rd-chat-open', show);
    if (show) {
      if (settings().provider === 'anthropic' && !fields.key.value) details.open = true;
      if (restoring) scrollToEnd(); else if (view === 'chat') input.focus();
    } else if (!restoring) {
      toggle.focus();
    }
    if (!restoring) saveSession(Boolean(running));
  }

  setWidth(width, false);
  fillFields(saved.provider || (config.chat && config.chat.provider) || 'anthropic');
  fields.provider.addEventListener('change', function () { fillFields(fields.provider.value); persist(); loadModels(); });
  fields.endpoint.addEventListener('change', function () {
    // Show the reader the URL that will actually be called (root or /v1 is completed).
    fields.endpoint.value = Agent.normalizeEndpoint(fields.provider.value, fields.endpoint.value).chat;
    persist();
    loadModels();
  });
  fields.key.addEventListener('change', function () { persist(); if (!modelList.length) loadModels(); });
  fields.model.addEventListener('change', persist);
  fields.stream.addEventListener('change', persist);
  fields.remember.addEventListener('change', persist);
  refresh.addEventListener('click', loadModels);
  toggle.hidden = false;
  toggle.addEventListener('click', function () { open(panel.hidden); });
  $('.rd-chat__close').addEventListener('click', function () { open(false); });
  $('.rd-chat__new').addEventListener('click', function () {
    if (running) running.abort();
    saveCurrent();
    current = newConversation();
    renderLog();
    if (view === 'history') showHistory(false);
    saveSession(false);
    input.focus();
  });
  stop.addEventListener('click', function () { if (running) running.abort(); });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var question = input.value.trim();
    if (!question || running) return;
    input.value = '';
    ask(question);
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  input.addEventListener('input', function () { if (!running) saveSession(false); });
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && event.target !== historyFilter) open(false);
  });
  // Leaving the page mid-answer loses the reply; mark it so the next page can say so.
  window.addEventListener('pagehide', function () { saveSession(Boolean(running)); });

  var restored = restoreSession();
  if (!current) current = newConversation();
  renderLog();
  if (restored.view === 'history') showHistory(true);
  if (restored.open) open(true, true);
  else doc.classList.remove('rd-chat-open');
}());
