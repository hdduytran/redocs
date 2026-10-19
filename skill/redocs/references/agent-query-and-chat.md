# Agent query and Ask AI

Agents and readers can ask questions about a book without RAG or embeddings. The model navigates
the book's own structure and runs a keyword index through seven read-only tools. The engine is
`assets/theme/redocs-query.js`, a single implementation that the CLI, the MCP server and the
in-book chat all share.

| Layer | Tool | Gives |
|---|---|---|
| L0 map | `book_map` | chapters → pages: title, kind, one-line summary, entities, open questions. Over 150 pages it lists chapters only; pass `chapter`. |
| L1 outline | `book_outline` | the sections of a page, cut at h1–h3 (anchor, title, size), plus its entities and links |
| L2 text | `book_search`, `book_read` | accent-insensitive BM25 over sections and entities (prefix match, phrase boost); reads a section with its subsections, paged by `offset` |
| L3 graph | `book_entity`, `book_changes` | lifecycle, `depends_on` / dependents, `replaced_by`, pages that mention an entity; the change sets between milestones |
| check | `book_citations` | which `page:<id>#<anchor>` references in a draft answer do not exist |

Every index belongs to one milestone; the default is the current one. The page summary comes from
`page.json` `summary`, or is taken from the first real paragraph (`summarySource: "auto"`). Give
key pages a `summary`, because it is the first thing a model reads.

## Agents (CLI and MCP)

```bash
redocs query <book> map [--chapter <id>] [--milestone v2]
redocs query <book> search billing database --k 5 [--kind service] [--chapter <id>]
redocs query <book> outline services/overview
redocs query <book> read page:services/overview#billing [--max-chars 8000] [--offset n]
redocs query <book> entity svc:billing --milestone v2
redocs query <book> changes [--from v1 --to v2]
redocs query <book> citations "… page:services/overview#billing …"
redocs mcp <book>          # the same tools over stdio; each takes an optional "milestone"
```

Example MCP client config (Kiro, Claude Code, Cursor and others use the same shape):

```json
{ "mcpServers": { "my-book": { "command": "node", "args": ["<skill-dir>/bin/redocs.mjs", "mcp", "<book-dir>"] } } }
```

The server neither writes to the book nor calls an LLM. It rebuilds its index when a source file
changes, so an agent sees its own edits on the next call.

## Readers (Ask AI panel)

Enable the panel in `book.json`; it is off by default:

```json
"chat": { "enabled": true, "provider": "anthropic", "model": "claude-sonnet-4-5", "maxToolRounds": 6 }
```

`provider` is `anthropic` or `openai-compatible` (vLLM, Ollama, LM Studio, a company gateway).
An optional `endpoint` sets the default URL, and `maxTokens` caps each reply. Readers can change
the provider, endpoint and key in *Model settings*. The endpoint can be a server root
(`http://gpu:8000`), a `/v1` URL or the full chat URL; it is completed to `…/v1/chat/completions`
(`…/v1/messages` for Anthropic). Changing the endpoint or key, or pressing ↻, fetches
`GET …/v1/models` and fills the model picker. The list is remembered, so other pages show it
without making a request. The key stays in `sessionStorage` unless the reader ticks *Remember*.

With chat enabled, `build` also writes `<milestone>/agent-index.js` and the chat scripts
(query, stream, agent, store, render, UI) under
`_redocs/`. The tool loop (`redocs-chat-agent.js`) runs in the page: every tool executes locally
over the index, and the only request is to the LLM endpoint, sent after the reader presses Send.
`redocs-chat-agent.js` is the only file in `dist/` that may make network calls; a build test
enforces this.

- Anthropic accepts direct browser calls from `file://`. The CORS preflight from origin `null`
  is allowed, and the agent sends `anthropic-dangerous-direct-browser-access: true`.
- A local server must allow the page origin. For Ollama, set `OLLAMA_ORIGINS` (for example `*`)
  before `ollama serve`.
- Answers are escaped HTML. `page:` and `entity:` references become links to the book, and
  references that do not exist are struck through.
- On screens 900px and wider the panel docks to the right and pushes the page left, so it covers
  nothing. Drag its left edge, use the arrow keys on it, or press ⇔ to widen it; the width is
  remembered. Narrower screens show it as a full-width sheet.
- Replies stream token by token over SSE for both providers, including tool calls. A server that
  ignores `stream: true` still works, and readers can turn streaming off in *Model settings*
  (`chat.stream` sets the default). While a reply is in progress the panel shows a status line
  (waiting / the book step being taken / writing, plus elapsed time), the steps taken so far and a
  Stop button. Each answer keeps a collapsible list of the steps it took.
- **History** lists saved conversations (newest first, filterable, deletable, *Clear all*).
  They are stored in `localStorage` under `redocs-chat-history:<book-id>`, in this browser only.
  Storage is capped at 50 conversations and about 3 MB; the oldest go first. The open state,
  current conversation and draft follow the reader across pages in `sessionStorage` for that
  tab. A question still running when the reader clicks away is lost, and the next page says so.

Enable chat only when readers may send book content to an LLM provider. The privacy note under
the input box tells them which host receives it.
