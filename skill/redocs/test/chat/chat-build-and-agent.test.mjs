// Approach B: the opt-in Ask AI panel. Off by default (the book stays network-free); when
// book.json chat.enabled is true the build ships the agent index + chat scripts, and the tool
// loop runs in the page against the reader's own LLM endpoint.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import '../../assets/theme/redocs-chat-stream.js';
import '../../assets/theme/redocs-chat-agent.js';
import { checkFilePages, findChrome } from '../../lib/chrome-cdp-file-protocol-check.mjs';
import { buildBook } from '../../lib/command-build-book-site.mjs';
import { checkBook } from '../../lib/command-check-book.mjs';
import { agentIndexFor } from '../../lib/query-book-index.mjs';
import { editJson, richBook, starterBook } from '../helpers/make-temp-book.mjs';

const Agent = globalThis.RedocsChatAgent;

function allFiles(root) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f); else out.push(f);
    }
  })(root);
  return out;
}

async function chatBook(chat = { enabled: true }) {
  const dir = await richBook();
  editJson(path.join(dir, 'book.json'), (c) => { c.chat = chat; });
  return dir;
}

test('chat is off by default: no agent index, no chat scripts, no panel', () => {
  const dir = starterBook();
  const result = buildBook({ book: dir });
  assert.equal(result.chat, false);
  assert.ok(!existsSync(path.join(dir, 'dist/v1/agent-index.js')));
  assert.ok(!existsSync(path.join(dir, 'dist/_redocs/redocs-chat-agent.js')));
  assert.doesNotMatch(readFileSync(path.join(dir, 'dist/v1/overview/system-context.html'), 'utf8'), /rd-chat/);
});

test('book.json chat settings are schema-checked', async () => {
  const dir = await chatBook({ enabled: true, provider: 'gpt', maxToolRounds: 99 });
  const rd001 = checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD001' && d.file === 'book.json');
  assert.ok(rd001.some((d) => /chat\/provider/.test(d.pointer)));
  assert.ok(rd001.some((d) => /chat\/maxToolRounds/.test(d.pointer)));
});

test('chat enabled: index per milestone, scripts, panel; network code confined to the agent script', async () => {
  const dir = await chatBook({ enabled: true, provider: 'openai-compatible', model: 'qwen3' });
  const result = buildBook({ book: dir });
  assert.equal(result.chat, true);
  for (const m of ['v1', 'v2', 'target']) {
    const js = readFileSync(path.join(dir, 'dist', m, 'agent-index.js'), 'utf8');
    const index = JSON.parse(js.replace(/^window\.__REDOCS_AGENT_INDEX=/, '').replace(/;\s*$/, ''));
    assert.equal(index.milestone.id, m);
  }
  const html = readFileSync(path.join(dir, 'dist/v2/services/overview.html'), 'utf8');
  assert.match(html, /class="rd-chat-toggle"[^>]*hidden/);
  assert.match(html, /id="rd-chat-config">\{"chat":\{"enabled":true,"provider":"openai-compatible","model":"qwen3"\},"page":"page:services\/overview","base":"\.\.\/"\}/);
  assert.match(html, /<script src="\.\.\/agent-index\.js"><\/script>\n<script src="\.\.\/\.\.\/_redocs\/redocs-query\.js">/);
  for (const file of allFiles(path.join(dir, 'dist')).filter((f) => /\.(html|js|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\s(?:href|src)="([^"]*)"/g)) assert.doesNotMatch(m[1], /^(\/|file:|https?:\/\/)/, file);
    if (!file.endsWith(`${path.sep}redocs-chat-agent.js`)) assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/, path.relative(dir, file));
  }
  assert.equal(buildBook({ book: dir }).distHash, result.distHash, 'still deterministic');
});

test('settings: reader choice > book.json > provider defaults', () => {
  assert.deepEqual(Agent.resolveSettings(undefined, {}), { provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: Agent.DEFAULTS.anthropic.model, maxToolRounds: 6, maxTokens: 2048, stream: true });
  const book = { provider: 'openai-compatible', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'm', maxToolRounds: 3 };
  assert.equal(Agent.resolveSettings(book, {}).endpoint, 'http://localhost:1234/v1/chat/completions');
  assert.equal(Agent.resolveSettings(book, { model: 'reader-model' }).model, 'reader-model');
  const switched = Agent.resolveSettings(book, { provider: 'anthropic' });
  assert.equal(switched.endpoint, Agent.DEFAULTS.anthropic.endpoint, "book endpoint belongs to the book's provider");
  assert.equal(switched.maxToolRounds, 3);
});

/** A scripted LLM: each call returns the next reply; requests are recorded. */
function fakeLlm(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const status = reply.status || 200;
    return { ok: status < 300, status, statusText: 'x', text: async () => JSON.stringify(reply.json ?? reply) };
  };
  return { calls, fetchImpl };
}

test('agent loop (Anthropic): tool_use runs locally, tool_result goes back, answer citations are checked', async () => {
  const dir = await richBook();
  const index = agentIndexFor(dir, 'v1');
  const llm = fakeLlm([
    { content: [{ type: 'text', text: 'Searching.' }, { type: 'tool_use', id: 't1', name: 'book_search', input: { query: 'cơ sở dữ liệu' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Billing dùng PostgreSQL (page:services/overview#billing), xem page:ghost.' }], stop_reason: 'end_turn', usage: { input_tokens: 10 } },
  ]);
  const events = [];
  const result = await Agent.runTurn({ index, settings: Agent.resolveSettings({}, {}), apiKey: 'sk-test', question: 'DB của billing?', page: 'page:services/overview', fetchImpl: llm.fetchImpl, onEvent: (e) => events.push(e) });
  assert.equal(llm.calls.length, 2);
  const [first, second] = llm.calls;
  assert.equal(first.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(first.headers['x-api-key'], 'sk-test');
  assert.equal(first.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(first.body.tools.map((t) => t.name), ['book_map', 'book_outline', 'book_search', 'book_read', 'book_entity', 'book_changes', 'book_citations']);
  assert.match(first.body.system, /Book map:\n[\s\S]*page:services\/overview/);
  assert.match(first.body.system, /on page page:services\/overview/);
  const toolResult = second.body.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 't1');
  assert.match(toolResult.content, /page:services\/overview#billing/);
  assert.deepEqual(events.filter((e) => e.type === 'tool').map((e) => e.name), ['book_search']);
  assert.match(result.answer, /PostgreSQL/);
  assert.equal(result.citations.invalid, 1);
  assert.equal(result.messages.length, 4, 'user, assistant(tool_use), user(tool_result), assistant');
  // The next turn continues the same native history.
  const next = fakeLlm([{ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }]);
  await Agent.runTurn({ index, settings: Agent.resolveSettings({}, {}), apiKey: 'k', messages: result.messages, question: 'Thêm?', fetchImpl: next.fetchImpl });
  assert.equal(next.calls[0].body.messages.length, 5);
});

test('agent loop (OpenAI-compatible): tool_calls -> tool messages; no key means no Authorization header', async () => {
  const dir = await richBook();
  const index = agentIndexFor(dir, 'v2');
  const llm = fakeLlm([
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'book_entity', arguments: '{"id":"svc:billing"}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Billing có từ v2 (entity:svc:billing).' } }] },
  ]);
  const settings = Agent.resolveSettings({ provider: 'openai-compatible' }, {});
  const result = await Agent.runTurn({ index, settings, question: 'Billing?', fetchImpl: llm.fetchImpl });
  assert.equal(llm.calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(llm.calls[0].headers.authorization, undefined);
  assert.equal(llm.calls[0].body.messages[0].role, 'system');
  assert.equal(llm.calls[0].body.tools[0].type, 'function');
  const toolMsg = llm.calls[1].body.messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.equal(JSON.parse(toolMsg.content).alive, true);
  assert.match(result.answer, /v2/);
});

test('agent loop: tool budget stops a model that never answers; HTTP errors surface', async () => {
  const dir = await richBook();
  const index = agentIndexFor(dir, 'v1');
  const loop = fakeLlm([{ content: [{ type: 'tool_use', id: 'x', name: 'book_map', input: {} }], stop_reason: 'tool_use' }]);
  const settings = { ...Agent.resolveSettings({}, {}), maxToolRounds: 2 };
  const result = await Agent.runTurn({ index, settings, apiKey: 'k', question: 'q', fetchImpl: loop.fetchImpl });
  assert.equal(loop.calls.length, 3, '2 tool rounds + 1 final request');
  assert.match(result.answer, /tool budget of 2 rounds/);
  assert.match(JSON.stringify(loop.calls[2].body.messages.at(-1).content), /Tool budget reached/);
  const denied = fakeLlm([{ status: 401, json: { error: { message: 'invalid x-api-key' } } }]);
  await assert.rejects(Agent.runTurn({ index, settings, apiKey: 'bad', question: 'q', fetchImpl: denied.fetchImpl }), /401\): invalid x-api-key/);
});

const chrome = findChrome();

test('reader over file://: panel opens, a mocked model answers with book links, no console errors', { skip: !chrome && 'Chrome not installed' }, async () => {
  const dir = await chatBook({ enabled: true });
  buildBook({ book: dir });
  const page = path.join(dir, 'dist/v1/services/overview.html');
  // Runs inside the page: replace fetch with a scripted model, then drive the real UI.
  const evaluate = `(async () => {
    const replies = [
      { content: [{ type: 'tool_use', id: 't1', name: 'book_search', input: { query: 'retry' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Thử lại **3 lần** (page:services/overview#retry-policy). <img src=x onerror=alert(1)>' }], stop_reason: 'end_turn' },
    ];
    let n = 0;
    window.fetch = async () => new Response(JSON.stringify(replies[n++]), { status: 200 });
    const toggle = document.querySelector('.rd-chat-toggle');
    const visible = !toggle.hidden;
    toggle.click();
    document.querySelector('[name="key"]').value = 'sk-test';
    document.querySelector('#rd-chat-input').value = 'Retry thế nào?';
    document.querySelector('.rd-chat__form').requestSubmit();
    for (let i = 0; i < 50 && !document.querySelector('.rd-chat__msg--assistant'); i += 1) await new Promise((r) => setTimeout(r, 50));
    const answer = document.querySelector('.rd-chat__msg--assistant');
    const link = answer && answer.querySelector('a.rd-chat__ref');
    return {
      visible,
      open: !document.getElementById('rd-chat').hidden,
      calls: n,
      activity: Array.from(document.querySelectorAll('.rd-chat__msg--assistant .rd-chat__steps li')).map((li) => li.textContent).join(' | '),
      href: link ? link.getAttribute('href') : null,
      strong: answer ? answer.querySelectorAll('strong').length : 0,
      injected: answer ? answer.querySelectorAll('img').length : -1,
    };
  })()`;
  const report = await checkFilePages([page], { evaluate, settleMs: 100 });
  const [result] = report.pages;
  assert.deepEqual(result.consoleErrors, []);
  assert.deepEqual(result.failedRequests, []);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, { visible: true, open: true, calls: 2, activity: 'Searching: retry', href: '../services/overview.html#retry-policy', strong: 1, injected: 0 });
});

test('reader over file://: the conversation survives a link click to another page in the same tab', { skip: !chrome && 'Chrome not installed' }, async () => {
  const dir = await chatBook({ enabled: true });
  buildBook({ book: dir });
  const first = `(async () => {
    window.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Xem page:services/overview#retry-policy.' }], stop_reason: 'end_turn' }), { status: 200 });
    document.querySelector('.rd-chat-toggle').click();
    document.querySelector('[name="key"]').value = 'sk-test';
    document.querySelector('[name="key"]').dispatchEvent(new Event('change'));
    document.querySelector('#rd-chat-input').value = 'Retry?';
    document.querySelector('.rd-chat__form').requestSubmit();
    for (let i = 0; i < 50 && !document.querySelector('.rd-chat__msg--assistant'); i += 1) await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#rd-chat-input').value = 'draft câu tiếp';
    document.querySelector('#rd-chat-input').dispatchEvent(new Event('input'));
    return true;
  })()`;
  // Home page sits one folder up from services/overview.html, so restored links must be re-based.
  const second = `(async () => {
    const bodies = [];
    window.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }), { status: 200 }); };
    const panel = document.getElementById('rd-chat');
    const restored = {
      open: !panel.hidden,
      expanded: document.querySelector('.rd-chat-toggle').getAttribute('aria-expanded'),
      users: document.querySelectorAll('.rd-chat__msg--user').length,
      href: (document.querySelector('a.rd-chat__ref') || {}).getAttribute?.('href') || null,
      draft: document.querySelector('#rd-chat-input').value,
      key: document.querySelector('[name="key"]').value,
    };
    document.querySelector('#rd-chat-input').value = 'Tiếp?';
    document.querySelector('.rd-chat__form').requestSubmit();
    for (let i = 0; i < 50 && document.querySelectorAll('.rd-chat__msg--assistant').length < 2; i += 1) await new Promise((r) => setTimeout(r, 50));
    restored.historySent = bodies.length ? bodies[0].messages.length : 0;
    return restored;
  })()`;
  const report = await checkFilePages([path.join(dir, 'dist/v1/services/overview.html')], { evaluate: first, next: { file: path.join(dir, 'dist/v1/index.html'), evaluate: second }, settleMs: 100 });
  const [result] = report.pages;
  assert.deepEqual(result.consoleErrors, []);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.nextValue, { open: true, expanded: 'true', users: 1, href: 'services/overview.html#retry-policy', draft: 'draft câu tiếp', key: 'sk-test', historySent: 3 });
});

test('endpoint: a server root, /v1 or the full URL all resolve to chat + models URLs', () => {
  const n = (p, u) => Agent.normalizeEndpoint(p, u);
  for (const typed of ['http://gpu:8000', 'http://gpu:8000/', 'http://gpu:8000/v1', 'http://gpu:8000/v1/chat/completions', 'http://gpu:8000/v1/models']) {
    assert.deepEqual(n('openai-compatible', typed), { chat: 'http://gpu:8000/v1/chat/completions', models: 'http://gpu:8000/v1/models' }, typed);
  }
  assert.deepEqual(n('openai-compatible', 'https://gw.example/openai/v1'), { chat: 'https://gw.example/openai/v1/chat/completions', models: 'https://gw.example/openai/v1/models' });
  assert.deepEqual(n('anthropic', ''), { chat: 'https://api.anthropic.com/v1/messages', models: 'https://api.anthropic.com/v1/models' });
  assert.equal(Agent.resolveSettings({ provider: 'openai-compatible', endpoint: 'http://gpu:8000' }, {}).endpoint, 'http://gpu:8000/v1/chat/completions');
});

test('listModels: GET /v1/models for vLLM-style and Anthropic servers', async () => {
  const vllm = fakeLlm([{ object: 'list', data: [{ id: 'Qwen/Qwen3-32B', object: 'model' }, { id: 'Qwen/Qwen3-32B' }, { id: 'llama-3.1-8b' }] }]);
  const list = await Agent.listModels({ settings: Agent.resolveSettings({}, { provider: 'openai-compatible', endpoint: 'http://gpu:8000' }), apiKey: 'tok', fetchImpl: vllm.fetchImpl });
  assert.deepEqual(list.map((m) => m.id), ['Qwen/Qwen3-32B', 'llama-3.1-8b'], 'deduplicated, server order');
  assert.equal(vllm.calls.length, 1);
  const anthropic = fakeLlm([{ data: [{ id: 'claude-x', display_name: 'Claude X' }] }]);
  const a = await Agent.listModels({ settings: Agent.resolveSettings({}, {}), apiKey: 'sk', fetchImpl: anthropic.fetchImpl });
  assert.deepEqual(a, [{ id: 'claude-x', label: 'Claude X' }]);
  const [call] = anthropic.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/models?limit=100');
  assert.equal(call.method, 'GET');
  assert.equal(call.headers['x-api-key'], 'sk');
  assert.equal(vllm.calls[0].headers.authorization, 'Bearer tok');
  const down = fakeLlm([{ status: 404, json: { detail: 'Not Found' } }]);
  await assert.rejects(Agent.listModels({ settings: Agent.resolveSettings({}, { provider: 'openai-compatible' }), fetchImpl: down.fetchImpl }), /404/);
});

test('reader over file://: typing an endpoint loads /v1/models into the picker; chat uses the chosen model', { skip: !chrome && 'Chrome not installed' }, async () => {
  const dir = await chatBook({ enabled: true, provider: 'openai-compatible' });
  buildBook({ book: dir });
  const evaluate = `(async () => {
    const requests = [];
    window.fetch = async (url, init) => {
      requests.push({ url, method: init.method, model: init.body ? JSON.parse(init.body).model : null });
      const body = /\\/models$/.test(url)
        ? { object: 'list', data: [{ id: 'Qwen/Qwen3-32B' }, { id: 'meta-llama/Llama-3.1-8B-Instruct' }] }
        : { choices: [{ message: { role: 'assistant', content: 'OK' } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    document.querySelector('.rd-chat-toggle').click();
    const loadedOnOpen = requests.length;
    const endpoint = document.querySelector('[name="endpoint"]');
    endpoint.value = 'http://gpu-box:8000';
    endpoint.dispatchEvent(new Event('change'));
    const select = document.querySelector('[name="model"]');
    for (let i = 0; i < 40 && select.options.length < 2; i += 1) await new Promise((r) => setTimeout(r, 25));
    const options = Array.from(select.options).map((o) => o.value);
    select.value = 'meta-llama/Llama-3.1-8B-Instruct';
    select.dispatchEvent(new Event('change'));
    document.querySelector('#rd-chat-input').value = 'Hi';
    document.querySelector('.rd-chat__form').requestSubmit();
    for (let i = 0; i < 40 && !document.querySelector('.rd-chat__msg--assistant'); i += 1) await new Promise((r) => setTimeout(r, 25));
    return { loadedOnOpen, endpoint: endpoint.value, options, status: document.querySelector('.rd-chat__models-status').textContent, requests };
  })()`;
  // A second page reuses the remembered list without any request.
  const next = `(() => ({ options: Array.from(document.querySelector('[name="model"]').options).map((o) => o.value), model: document.querySelector('[name="model"]').value }))()`;
  const report = await checkFilePages([path.join(dir, 'dist/v1/vision/why.html')], { evaluate, next: { file: path.join(dir, 'dist/v1/services/overview.html'), evaluate: next }, settleMs: 100 });
  const [result] = report.pages;
  assert.deepEqual(result.consoleErrors, []);
  assert.equal(result.value.loadedOnOpen, 0, 'no request before the reader acts');
  assert.equal(result.value.endpoint, 'http://gpu-box:8000/v1/chat/completions');
  assert.deepEqual(result.value.options, ['Qwen/Qwen3-32B', 'meta-llama/Llama-3.1-8B-Instruct']);
  assert.match(result.value.status, /2 model\(s\) on gpu-box:8000/);
  assert.deepEqual(result.value.requests, [
    { url: 'http://gpu-box:8000/v1/models', method: 'GET', model: null },
    { url: 'http://gpu-box:8000/v1/chat/completions', method: 'POST', model: 'meta-llama/Llama-3.1-8B-Instruct' },
  ]);
  assert.deepEqual(result.nextValue, { options: ['Qwen/Qwen3-32B', 'meta-llama/Llama-3.1-8B-Instruct'], model: 'meta-llama/Llama-3.1-8B-Instruct' });
});
