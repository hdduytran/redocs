// Ask AI UX: streaming (SSE) for both providers, local conversation history, safe rendering,
// and the docked panel that pushes the page instead of covering it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import markdownit from 'markdown-it';
import '../../assets/theme/redocs-chat-stream.js';
import '../../assets/theme/redocs-chat-agent.js';
import '../../assets/theme/redocs-chat-store.js';
import '../../assets/theme/redocs-chat-render.js';
import { checkFilePages, findChrome } from '../../lib/chrome-cdp-file-protocol-check.mjs';
import { buildBook } from '../../lib/command-build-book-site.mjs';
import { agentIndexFor } from '../../lib/query-book-index.mjs';
import { editJson, richBook } from '../helpers/make-temp-book.mjs';

const { RedocsChatStream: Stream, RedocsChatAgent: Agent, RedocsChatStore: Store, RedocsChatRender: Render } = globalThis;
const dir = await richBook();
const index = agentIndexFor(dir, 'v1');

/** A text/event-stream Response whose body arrives in the given (arbitrarily split) chunks. */
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const sse = (events) => events.map((e) => (e.event ? `event: ${e.event}\n` : '') + `data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
/** Split a string into pieces of n chars, to cut SSE lines and JSON mid-way. */
const pieces = (s, n) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g'));

test('SSE parser: events split across chunks, multi-line data, comments, flush', () => {
  const p = Stream.createSseParser();
  assert.deepEqual(p.feed(': keep-alive\n\nevent: a\ndata: {"x"'), []);
  assert.deepEqual(p.feed(':1}\n\ndata: l1\ndata: l2\r\n\r\n'), [{ event: 'a', data: '{"x":1}' }, { event: 'message', data: 'l1\nl2' }]);
  assert.deepEqual(p.feed('data: tail'), []);
  assert.deepEqual(p.flush(), [{ event: 'message', data: 'tail' }]);
});

test('streaming (OpenAI-compatible / vLLM): text deltas emitted, tool_calls reassembled from fragments', async () => {
  const round1 = sse([
    { data: { choices: [{ delta: { role: 'assistant', content: '' } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'book_search', arguments: '' } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"retry"}' } }] }, finish_reason: 'tool_calls' }] } },
    { data: '[DONE]' },
  ]);
  const round2 = sse([
    { data: { choices: [{ delta: { content: 'Thử lại ' } }] } },
    { data: { choices: [{ delta: { content: '3 lần (page:services/overview#retry-policy).' } }] } },
    { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
    { data: '[DONE]' },
  ]);
  const bodies = [];
  const responses = [pieces(round1, 7), pieces(round2, 5)];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return sseResponse(responses[bodies.length - 1]); };
  const events = [];
  const settings = Agent.resolveSettings({ provider: 'openai-compatible' }, {});
  const result = await Agent.runTurn({ index, settings, question: 'Retry?', fetchImpl, onEvent: (e) => events.push(e) });
  assert.equal(bodies[0].stream, true);
  const call = bodies[1].messages.find((m) => m.tool_calls);
  assert.deepEqual(call.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'book_search', arguments: '{"query":"retry"}' } }]);
  assert.equal(bodies[1].messages.at(-1).role, 'tool');
  assert.equal(result.answer, 'Thử lại 3 lần (page:services/overview#retry-policy).');
  assert.equal(events.filter((e) => e.type === 'delta' && e.round === 1).map((e) => e.text).join(''), result.answer);
  assert.deepEqual(events.map((e) => e.type).filter((t) => t !== 'delta'), ['request', 'round', 'tool', 'tool-done', 'request', 'round']);
});

test('streaming (Anthropic): text + tool_use with input_json_delta, then the answer', async () => {
  const round1 = sse([
    { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 5 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Tìm…' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'book_entity', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id": "svc:' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'gateway"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
  const round2 = sse([
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Gateway (entity:svc:gateway).' } } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } },
  ]);
  const bodies = [];
  const responses = [pieces(round1, 11), [round2]];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return sseResponse(responses[bodies.length - 1]); };
  const result = await Agent.runTurn({ index, settings: Agent.resolveSettings({}, {}), apiKey: 'k', question: 'Gateway?', fetchImpl });
  const assistant = bodies[1].messages[1];
  assert.deepEqual(assistant.content, [{ type: 'text', text: 'Tìm…' }, { type: 'tool_use', id: 'tu1', name: 'book_entity', input: { id: 'svc:gateway' } }]);
  assert.equal(bodies[1].messages[2].content[0].tool_use_id, 'tu1');
  assert.equal(result.answer, 'Gateway (entity:svc:gateway).');
});

test('streaming: a server that ignores stream:true and answers JSON still works; stream errors surface', async () => {
  const json = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'plain' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const r = await Agent.runTurn({ index, settings: Agent.resolveSettings({ provider: 'openai-compatible' }, {}), question: 'q', fetchImpl: json });
  assert.equal(r.answer, 'plain');
  const broken = async () => sseResponse([sse([{ data: { error: { message: 'model overloaded' } } }])]);
  await assert.rejects(Agent.runTurn({ index, settings: Agent.resolveSettings({ provider: 'openai-compatible' }, {}), question: 'q', fetchImpl: broken }), /model overloaded/);
  const off = Agent.resolveSettings({ provider: 'openai-compatible' }, { stream: false });
  const bodies = [];
  await Agent.runTurn({ index, settings: off, question: 'q', fetchImpl: async (u, init) => { bodies.push(JSON.parse(init.body)); return json(); } });
  assert.equal(bodies[0].stream, undefined, 'stream off sends a plain request');
});

function fakeStorage() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

test('history store: put/get/list newest first, title from first question, filter, remove, clear', () => {
  let t = 1000;
  const s = Store.create(fakeStorage(), 'book', { now: () => (t += 10) });
  s.put({ id: 'a', turns: [{ role: 'user', text: 'Billing dùng database gì?' }, { role: 'assistant', text: 'PostgreSQL' }], messages: [] });
  s.put({ id: 'b', turns: [{ role: 'user', text: 'Gateway' }], messages: [] });
  assert.deepEqual(s.list().map((c) => c.id), ['b', 'a']);
  assert.equal(s.get('a').title, 'Billing dùng database gì?');
  assert.equal(s.list()[1].questions, 1);
  s.put({ ...s.get('a'), turns: [...s.get('a').turns, { role: 'user', text: 'Thêm?' }] });
  assert.deepEqual(s.list().map((c) => c.id), ['a', 'b'], 'updating moves it to the top');
  assert.deepEqual(s.list('postgresql').map((c) => c.id), ['a'], 'filter searches turn text');
  assert.deepEqual(s.list('DATABASE GI').map((c) => c.id), ['a'], 'accent- and case-insensitive');
  s.remove('a');
  assert.deepEqual(s.list().map((c) => c.id), ['b']);
  s.clear();
  assert.deepEqual(s.list(), []);
});

test('history store: bounded by count and size; survives a storage that refuses writes', () => {
  let t = 0;
  const s = Store.create(fakeStorage(), 'b', { now: () => (t += 1), maxConversations: 3, maxChars: 4000 });
  for (let i = 0; i < 5; i += 1) s.put({ id: `c${i}`, turns: [{ role: 'user', text: `q${i}` }], messages: [] });
  assert.deepEqual(s.list().map((c) => c.id), ['c4', 'c3', 'c2']);
  s.put({ id: 'big', turns: [{ role: 'user', text: 'big' }], messages: [{ role: 'user', content: 'x'.repeat(5000) }] });
  const big = s.get('big');
  assert.equal(big.trimmed, true, 'too big alone: keeps turns, drops model history');
  assert.deepEqual(big.messages, []);
  assert.deepEqual(s.list().map((c) => c.id), ['big'], 'older ones dropped to fit');
  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} };
  const m = Store.create(refusing, 'b');
  m.put({ id: 'x', turns: [{ role: 'user', text: 'hi' }], messages: [] });
  assert.equal(m.get('x').title, 'hi', 'falls back to memory for this tab');
});

test('render: escapes model output, links valid refs, strikes unknown ones, renders steps and meta', () => {
  const r = Render.create({ index, base: '../', markdownit });
  const html = r.markdown('**Bold** <img src=x onerror=alert(1)> `code` page:services/overview#billing page:nope entity:svc:gateway\n\n- a\n- b\n\n```js\nlet x = "<b>";\n```');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<a class="rd-chat__ref" href="\.\.\/services\/overview\.html#billing" title="page:services\/overview#billing">Services › Billing<\/a>/);
  assert.match(html, /rd-chat__badref[^>]*>page:nope</);
  assert.match(html, /href="\.\.\/catalog\/service\.html#svc-gateway"[^>]*>Gateway</);
  assert.match(html, /<ul>\n<li>a<\/li>\n<li>b<\/li>\n<\/ul>/);
  assert.match(html, /<pre><code>let x = &quot;&lt;b&gt;&quot;;\n<\/code><\/pre>/);
  const turn = r.turn({ role: 'assistant', text: 'OK', steps: ['Searching: retry'], invalid: 1, meta: 'qwen · 3s' });
  assert.match(turn, /1 step\(s\) in the book/);
  assert.match(turn, /1 cited reference\(s\) do not exist/);
  assert.match(turn, /qwen · 3s/);
  assert.equal(r.turn({ role: 'user', text: '<b>x</b>\ny' }), '<p>&lt;b&gt;x&lt;/b&gt;<br>y</p>');
});

test('render: full Markdown from the model -- headings, tables, nested lists, quotes, links', () => {
  const r = Render.create({ index, base: '../', markdownit });
  const html = r.markdown([
    '## Kiến trúc', '', 'Đoạn đầu.', '', '### Bảng', '',
    '| Service | DB |', '|---|:-:|', '| `page:services/overview` | **pg** |', '| gateway | - |', '',
    '1. Một', '   - con a', '   - con b', '2. Hai', '',
    '> Ghi chú *nghiêng*', '', '---', '',
    '[Billing](page:services/overview#billing) [x](page:nope) [ext](https://example.com) [js](javascript:alert(1))',
    '![img](https://example.com/a.png)',
  ].join('\n'));
  assert.match(html, /<h2>Kiến trúc<\/h2>/);
  assert.match(html, /<h3>Bảng<\/h3>/);
  assert.match(html, /<div class="rd-chat__table"><table>/);
  assert.match(html, /<th>Service<\/th>/);
  assert.match(html, /<th style="text-align:center">DB<\/th>/);
  assert.match(html, /<td><a class="rd-chat__ref" href="\.\.\/services\/overview\.html"[^>]*>Services<\/a><\/td>/);
  assert.match(html, /<td style="text-align:center"><strong>pg<\/strong><\/td>/);
  assert.match(html, /<ol>\n<li>Một\n<ul>\n<li>con a<\/li>/, 'nested list');
  assert.match(html, /<blockquote>\n<p>Ghi chú <em>nghiêng<\/em><\/p>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<a href="\.\.\/services\/overview\.html#billing" class="rd-chat__ref" title="page:services\/overview#billing">Billing<\/a>/);
  assert.match(html, /<a href="#" class="rd-chat__badref"[^>]*>x<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">ext<\/a>/);
  assert.doesNotMatch(html, /href="javascript/, 'unsafe link schemes are not linked');
  assert.doesNotMatch(html, /<img/, 'images never load remote URLs');
  // Streaming: a half-written table still renders without throwing.
  assert.match(r.markdown('| a | b |\n|---|---|\n| 1'), /<table>/);
});

test('render: built-in fallback when markdown-it is not loaded', () => {
  const r = Render.create({ index, base: '../', markdownit: null });
  const html = r.markdown('### Tiêu đề\n\n- a\n- b');
  assert.match(html, /rd-chat__h/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
});

const chrome = findChrome();

async function chatSite() {
  const d = await richBook();
  editJson(path.join(d, 'book.json'), (c) => { c.chat = { enabled: true, provider: 'openai-compatible', model: 'm1' }; });
  buildBook({ book: d });
  return d;
}

test('reader: docked panel pushes the page (no overlap), resizes by keyboard and remembers the width', { skip: !chrome && 'Chrome not installed' }, async () => {
  const d = await chatSite();
  const evaluate = `(async () => {
    const box = (el) => el.getBoundingClientRect();
    const main = document.querySelector('.rd-main');
    const before = box(main).right;
    document.querySelector('.rd-chat-toggle').click();
    await new Promise((r) => setTimeout(r, 50));
    const panel = document.getElementById('rd-chat');
    const docked = { mainRight: Math.round(box(main).right), panelLeft: Math.round(box(panel).left), panelWidth: Math.round(box(panel).width), headerRight: Math.round(box(document.querySelector('.rd-header')).right) };
    const handle = document.querySelector('.rd-chat__resize');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const widened = Math.round(box(panel).width);
    document.querySelector('.rd-chat__expand').click();
    await new Promise((r) => setTimeout(r, 30));
    const expanded = Math.round(box(panel).width);
    const pressed = document.querySelector('.rd-chat__expand').getAttribute('aria-pressed');
    document.querySelector('.rd-chat__close').click();
    await new Promise((r) => setTimeout(r, 30));
    return { before: Math.round(before), docked, widened, expanded, pressed, closedMainRight: Math.round(box(main).right), saved: localStorage.getItem('redocs-chat-width') };
  })()`;
  const report = await checkFilePages([path.join(d, 'dist/v1/services/overview.html')], { evaluate, settleMs: 100 });
  const [r] = report.pages;
  assert.deepEqual(r.consoleErrors, []);
  const v = r.value;
  assert.equal(v.docked.panelWidth, 480);
  assert.ok(v.docked.mainRight <= v.docked.panelLeft, `content ends (${v.docked.mainRight}) before the panel starts (${v.docked.panelLeft})`);
  assert.ok(v.docked.headerRight <= v.docked.panelLeft + 1, 'header is not covered either');
  assert.equal(v.widened, 512);
  assert.equal(v.expanded, Math.round(1280 * 0.65));
  assert.equal(v.pressed, 'true');
  assert.equal(v.closedMainRight, v.before, 'closing gives the space back');
  assert.equal(v.saved, String(Math.round(1280 * 0.65)));
});

test('reader: streaming bubble + waiting status, then history keeps, reopens and deletes conversations', { skip: !chrome && 'Chrome not installed' }, async () => {
  const d = await chatSite();
  const evaluate = `(async () => {
    const enc = new TextEncoder();
    let release;
    const gate = new Promise((r) => { release = r; });
    let n = 0;
    window.fetch = async () => {
      n += 1;
      const answer = n === 1 ? 'Billing dùng PostgreSQL (page:services/overview#billing).' : 'Gateway nhận request (entity:svc:gateway).';
      const body = new ReadableStream({
        async start(c) {
          c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: answer.slice(0, 12) } }] }) + '\\n\\n'));
          if (n === 1) await gate; // hold the stream open so the page can be observed mid-answer
          c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: answer.slice(12) }, finish_reason: 'stop' }] }) + '\\n\\ndata: [DONE]\\n\\n'));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const $ = (s) => document.querySelector(s);
    const wait = async (fn) => { for (let i = 0; i < 80 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 25)); return fn(); };
    $('.rd-chat-toggle').click();
    $('#rd-chat-input').value = 'Billing dùng database gì?';
    $('.rd-chat__form').requestSubmit();
    await wait(() => $('.rd-chat__msg.is-streaming'));
    const mid = { streaming: $('.rd-chat__msg.is-streaming').textContent, status: $('.rd-chat__status').hidden ? null : $('.rd-chat__status-text').textContent, stopVisible: !$('.rd-chat__stop').hidden };
    release();
    await wait(() => $('.rd-chat__msg--assistant:not(.is-streaming)'));
    const done = { answer: $('.rd-chat__msg--assistant').textContent, statusHidden: $('.rd-chat__status').hidden, link: $('.rd-chat__msg--assistant a.rd-chat__ref').getAttribute('href') };
    $('.rd-chat__new').click();
    $('#rd-chat-input').value = 'Gateway?';
    $('.rd-chat__form').requestSubmit();
    await wait(() => document.querySelectorAll('.rd-chat__msg--assistant').length === 1 && !$('.rd-chat__msg.is-streaming') && $('.rd-chat__status').hidden);
    $('.rd-chat__history-btn').click();
    const titles = Array.from(document.querySelectorAll('.rd-chat__history-title')).map((e) => e.textContent);
    const current = $('.rd-chat__history-item.is-current .rd-chat__history-title').textContent;
    const logHidden = $('.rd-chat__log').hidden;
    $('#rd-chat-history-filter').value = 'postgres';
    $('#rd-chat-history-filter').dispatchEvent(new Event('input'));
    const filtered = Array.from(document.querySelectorAll('.rd-chat__history-title')).map((e) => e.textContent);
    $('#rd-chat-history-filter').value = '';
    $('#rd-chat-history-filter').dispatchEvent(new Event('input'));
    document.querySelectorAll('.rd-chat__history-open')[1].click();
    const reopened = { users: Array.from(document.querySelectorAll('.rd-chat__msg--user')).map((e) => e.textContent), view: $('.rd-chat__history').hidden ? 'chat' : 'history' };
    $('.rd-chat__history-btn').click();
    $('.rd-chat__history-item.is-current .rd-chat__history-delete').click(); // delete the open one
    const afterDelete = Array.from(document.querySelectorAll('.rd-chat__history-title')).map((e) => e.textContent);
    const logReset = document.querySelectorAll('.rd-chat__msg--user').length;
    const stored = JSON.parse(localStorage.getItem('redocs-chat-history:rich')).conversations.length;
    return { mid, done, titles, current, logHidden, filtered, reopened, afterDelete, logReset, stored };
  })()`;
  const next = `(() => ({ open: !document.getElementById('rd-chat').hidden, historyView: !document.querySelector('.rd-chat__history').hidden, items: document.querySelectorAll('.rd-chat__history-item').length }))()`;
  const report = await checkFilePages([path.join(d, 'dist/v1/services/overview.html')], { evaluate, next: { file: path.join(d, 'dist/v1/vision/why.html'), evaluate: next }, settleMs: 100 });
  const [r] = report.pages;
  assert.deepEqual(r.consoleErrors, []);
  assert.equal(r.error, undefined);
  const v = r.value;
  assert.equal(v.mid.streaming, 'Billing dùng');
  assert.equal(v.mid.status, 'Writing…');
  assert.equal(v.mid.stopVisible, true);
  assert.match(v.done.answer, /Billing dùng PostgreSQL \(Services › Billing\)\./);
  assert.equal(v.done.statusHidden, true);
  assert.equal(v.done.link, '../services/overview.html#billing');
  assert.deepEqual(v.titles, ['Gateway?', 'Billing dùng database gì?']);
  assert.equal(v.current, 'Gateway?');
  assert.equal(v.logHidden, true);
  assert.deepEqual(v.filtered, ['Billing dùng database gì?']);
  assert.deepEqual(v.reopened, { users: ['Billing dùng database gì?'], view: 'chat' });
  assert.deepEqual(v.afterDelete, ['Gateway?']);
  assert.equal(v.logReset, 0, 'deleting the open conversation starts a new one');
  assert.equal(v.stored, 1);
  assert.deepEqual(r.nextValue, { open: true, historyView: true, items: 1 }, 'panel, history view and saved list follow to the next page');
});
