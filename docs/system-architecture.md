# System architecture

ReDocs is a Node CLI that the agent calls; there is no long-running process. The full picture,
with diagrams, is in the [ReDocs design book](https://hdduytran.github.io/redocs-book/)
(chapters *Overview* and *Decisions*). This file keeps the boundaries and decisions a contributor
must not break.

## Boundaries

| Boundary | Rule | Owner |
|---|---|---|
| Book repository ↔ skill | The skill never stores book state; a book is plain files a later agent can read. | [`lib/load-book-from-directory.mjs`](../skill/redocs/lib/load-book-from-directory.mjs) |
| Loading ↔ judging | The loader and renderers never throw for content problems; they record diagnostics and references. Only `check` decides what is an error. | [`lib/check-book-rules.mjs`](../skill/redocs/lib/check-book-rules.mjs) |
| Check ↔ build | Both consume the same in-memory render, so what was validated is what gets written. | [`lib/render-book-pages.mjs`](../skill/redocs/lib/render-book-pages.mjs) |
| Engine ↔ tools | Diagram and wireframe tools run behind a plugin adapter and are never forked. | [`lib/load-plugin-registry.mjs`](../skill/redocs/lib/load-plugin-registry.mjs), [`plugins/`](../skill/redocs/plugins/) |
| Output ↔ network | Generated HTML loads nothing remote and calls no `fetch()`. The one exception is the opt-in Ask AI panel (`book.json` `chat.enabled`): only `_redocs/redocs-chat-agent.js` may call the network, only the LLM endpoint the reader configures, and only after they press Send. | `RD009` in the check rules, build and chat tests |
| Query engine ↔ surfaces | One engine (`assets/theme/redocs-query.js`, a classic script so it loads over `file://`) serves `redocs query`, `redocs mcp` and the in-book chat. The tools are read-only and never call an LLM. | [`lib/query-book-index.mjs`](../skill/redocs/lib/query-book-index.mjs), [`lib/build-agent-index.mjs`](../skill/redocs/lib/build-agent-index.mjs) |
| Paths | All output URLs come from one layout definition and are relative. | [`lib/site-paths-and-urls.mjs`](../skill/redocs/lib/site-paths-and-urls.mjs) |

## Decision ledger

| Decision | Why | Rejected alternative |
|---|---|---|
| Own small builder | Static site generators load search indexes with `fetch()`, which Chrome blocks under `file://`. The skill also needs a gate it controls. | Astro Starlight, Docusaurus, MkDocs |
| One full page tree per milestone | The URL states the milestone, no JavaScript is needed to read the right content, and every link is a real file `check` can verify. | One tree with JS switching content |
| Runtime data through `<script src>` | It is the one data channel that works under `file://` (verified in the spike). | JSON over `fetch()` |
| Iframe + `postMessage` height for embeds | The parent cannot read an iframe's document under `file://`, but the iframe can report its height. | Reading `contentDocument`; fixed heights only |
| Receipts carry the spec's sha256 | A diagram older than its spec is detected without re-rendering. | Re-rendering on every build (archify runs its own browser gate, which is slow) |
| A failed render keeps the previous output | A book never loses a working diagram because of a bad edit. | Deleting output on failure |
| Plugin notices are relayed, not stored | Receipts stay stable across renders. | Storing the archify update notice in the receipt |
| Browser gate over CDP `--remote-debugging-pipe` with no relaxed file flags | It must see exactly what a reader double-clicking `index.html` sees, without ports or WebSocket. | Puppeteer/Playwright dependency; `--allow-file-access-from-files` |
| Book-defined plugins need `--allow-book-plugins` | They run code from the book repository. | Loading any plugin a book declares |
| Strict entity checks only on milestone variants | Shared pages (vision, proposals) legitimately mention future or removed components. | Checking every page against every milestone |
| Warn on page sources a page never renders | Found in dogfooding: an `index.md` silently shadowed an `index.html`. | Picking a file silently |
| Vectorless retrieval: structure map + BM25 + entity graph, navigated by the model with tools | The book already has explicit structure (chapters, sections, entities, milestones). Indexes are deterministic, work offline and need no embedding service. | RAG with embeddings / vector DB |
| MCP server without an SDK | Only four methods are needed, and it keeps the dependency list at three. | `@modelcontextprotocol/sdk` |
| Chat tool loop runs in the page with the reader's own key or local model | No ReDocs server, and the static/file:// model is kept. | A hosted proxy (Lambda/Bedrock); embedding a shared key in the book |
