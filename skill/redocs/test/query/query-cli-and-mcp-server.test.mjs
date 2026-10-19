// Approach D: the query tools from the terminal (`redocs query`) and as an MCP server
// (`redocs mcp`, newline-delimited JSON-RPC over stdio). Both read; neither writes the book.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createMcpHandler, MCP_INSTRUCTIONS } from '../../lib/command-mcp-server.mjs';
import { richBook } from '../helpers/make-temp-book.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bin/redocs.mjs');
const dir = await richBook();

function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function snapshot(root) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f); else out.push(`${f}:${readFileSync(f, 'utf8').length}`);
    }
  })(root);
  return out.join('\n');
}

test('query CLI: human output, --json receipts and exit codes', () => {
  const map = cli('query', dir, 'map');
  assert.equal(map.code, 0, map.err);
  assert.match(map.out, /## Services \(services\) · 1 page\(s\)/);
  const search = cli('query', dir, 'search', 'cơ', 'sở', 'dữ', 'liệu', '--k', '1', '--json');
  assert.equal(search.code, 0, search.err);
  const parsed = JSON.parse(search.out);
  assert.equal(parsed.command, 'query');
  assert.equal(parsed.tool, 'book_search');
  assert.equal(parsed.results[0].ref, 'page:services/overview#billing');
  const read = cli('query', dir, 'read', 'page:services/overview#billing');
  assert.match(read.out, /Retry policy/);
  const entity = cli('query', dir, 'entity', 'svc:billing', '--milestone', 'v2');
  assert.match(entity.out, /alive at v2/);
  const changes = cli('query', dir, 'changes', '--milestone', 'v2');
  assert.match(changes.out, /replaced: svc:monolith -> svc:billing/);
  assert.equal(cli('query', dir, 'outline', 'ghost/page').code, 1, 'lookup miss is a failed result');
  assert.equal(cli('query', dir, 'map', '--milestone', 'v9').code, 2, 'unknown milestone is a usage error');
  assert.equal(cli('query', dir, 'nope').code, 2);
});

test('MCP handler: initialize, tools/list with milestone enum, tools/call, notifications, errors', () => {
  const handle = createMcpHandler({ book: dir });
  const init = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'redocs');
  assert.equal(init.result.instructions, MCP_INSTRUCTIONS);
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const search = list.result.tools.find((t) => t.name === 'book_search');
  assert.deepEqual(search.inputSchema.properties.milestone.enum, ['v1', 'v2', 'target']);
  assert.deepEqual(search.inputSchema.required, ['query']);
  const call = handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'book_search', arguments: { query: 'split billing', milestone: 'v2', kind: 'proposal' } } });
  assert.equal(call.result.isError, false);
  assert.equal(JSON.parse(call.result.content[0].text).results[0].page, 'proposals/split-billing');
  const miss = handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'book_read', arguments: { ref: 'page:ghost' } } });
  assert.equal(miss.result.isError, true);
  const badMilestone = handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'book_map', arguments: { milestone: 'v9' } } });
  assert.equal(badMilestone.result.isError, true);
  assert.match(badMilestone.result.structuredContent.error, /Unknown milestone/);
  assert.equal(handle({ jsonrpc: '2.0', id: 6, method: 'resources/list' }).error.code, -32601);
  assert.deepEqual(handle({ jsonrpc: '2.0', id: 7, method: 'ping' }).result, {});
});

test('MCP over stdio: one JSON response per request line, nothing else on stdout, book untouched', async () => {
  const before = snapshot(dir);
  const child = spawn(process.execPath, [CLI, 'mcp', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'book_entity', arguments: { id: 'svc:gateway' } } },
  ];
  child.stdin.end(`${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  const responses = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(responses.map((r) => r.id), [1, 2, 3, null]);
  assert.equal(responses[3].error.code, -32700);
  assert.deepEqual(JSON.parse(responses[2].result.content[0].text).entity.depends_on, ['svc:monolith']);
  assert.equal(snapshot(dir), before);
});
