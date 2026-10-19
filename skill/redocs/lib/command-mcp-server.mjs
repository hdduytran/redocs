// `redocs mcp <book>`: the agent query tools as an MCP server over stdio (newline-delimited
// JSON-RPC 2.0). No SDK dependency: initialize, ping, tools/list and tools/call are all an
// agent client needs here. stdout carries protocol messages only; diagnostics go to stderr.
//
// The server never writes to the book and never calls an LLM: the client's model does the
// reasoning, ReDocs answers deterministic lookups (approach D).

import { createInterface } from 'node:readline';
import { agentIndexFor, dispatch, loadAgentIndexes, TOOL_SPECS } from './query-book-index.mjs';
import { REDOCS_VERSION } from './redocs-version.mjs';

const SERVER_INFO = { name: 'redocs', version: REDOCS_VERSION };
const DEFAULT_PROTOCOL = '2025-06-18';

export const MCP_INSTRUCTIONS = `Read-only tools over one ReDocs system design book.
1. Call book_map first (pass a chapter for large books), then book_search and/or book_outline, then book_read only the sections you need.
2. Milestones are architecture states (v1, v2, target), not document versions. Every tool takes an optional "milestone" (default: the current one); answer at the milestone the user asks about and say which one you used.
3. Use book_entity for a component's lifecycle, dependencies and the pages that mention it; book_changes for what differs between milestones.
4. Cite every fact as page:<id>#<anchor>; check a draft with book_citations. If the book does not say it, say so; do not guess. TODO(owner) markers are unanswered questions, not facts.`;

function toolsWithMilestone(milestones) {
  return TOOL_SPECS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      ...t.input_schema,
      properties: { ...t.input_schema.properties, milestone: { type: 'string', enum: milestones, description: 'Milestone to read (default: current).' } },
    },
  }));
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * A transport-free handler, so tests can drive the protocol without spawning a process.
 * @returns {(message: object) => object|null} response, or null for notifications
 */
export function createMcpHandler({ book }) {
  return function handle(message) {
    const { id, method, params = {} } = message || {};
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize':
          return rpcResult(id, {
            protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: MCP_INSTRUCTIONS,
          });
        case 'ping':
          return rpcResult(id, {});
        case 'tools/list': {
          const loaded = loadAgentIndexes(book);
          return rpcResult(id, { tools: toolsWithMilestone([...loaded.indexes.keys()]) });
        }
        case 'tools/call': {
          const { name, arguments: args = {} } = params;
          const { milestone, ...input } = args;
          let result;
          try {
            result = dispatch(agentIndexFor(book, milestone), name, input);
          } catch (error) {
            result = { ok: false, error: error.message, hint: error.hint };
          }
          return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: result.ok === false });
        }
        default:
          if (!isRequest) return null; // notifications/initialized, notifications/cancelled, …
          return rpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      return isRequest ? rpcError(id, -32603, error.message) : null;
    }
  };
}

/** Serve until stdin closes. Resolves with the number of requests handled. */
export function runMcpServer({ book, input = process.stdin, output = process.stdout, log = process.stderr }) {
  loadAgentIndexes(book); // fail fast on a book that cannot load
  const handle = createMcpHandler({ book });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let handled = 0;
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(rpcError(null, -32700, 'Parse error'))}\n`);
      return;
    }
    const response = handle(message);
    handled += 1;
    if (response) output.write(`${JSON.stringify(response)}\n`);
  });
  log.write(`redocs mcp: serving ${book} over stdio\n`);
  return new Promise((resolve) => rl.on('close', () => resolve(handled)));
}
