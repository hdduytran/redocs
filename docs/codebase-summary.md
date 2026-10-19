# Codebase summary

Navigation only. Read the owning file for behaviour.

## Entry points

- CLI: [`skill/redocs/bin/redocs.mjs`](../skill/redocs/bin/redocs.mjs) — the command table and usage text are the authority for commands and flags.
- Agent contract: [`skill/redocs/SKILL.md`](../skill/redocs/SKILL.md), with branch documents in [`skill/redocs/references/`](../skill/redocs/references/).
- Tests: the `test` script in [`package.json`](../package.json) runs everything under [`skill/redocs/test/`](../skill/redocs/test/).

## Module groups (`skill/redocs/lib/`)

File names describe their role; start from the group that owns the change.

| Group | Files start with | Owns |
|---|---|---|
| Book model | `load-book-`, `validate-book-schemas`, `milestone-order-` | Reading a book, schema validation, milestone ordering and variant resolution |
| Rendering | `render-` | Markdown and HTML-fragment extensions, references, the page shell |
| Site output | `site-paths-`, `build-generated-pages`, `command-build-` | `dist/` layout, generated catalog/changes/compare pages, writing the site |
| Gate | `check-book-rules`, `command-check-`, `command-finalize-`, `chrome-cdp-` | Check rules, finalize, the file:// browser check |
| Authoring | `command-init-`, `command-add-`, `command-promote-` | Commands that edit a book |
| Reviewing | `command-comment` | Comment threads in `comments/<page-id>.jsonl` (add, reply, resolve, list) |
| Agent query | `build-agent-index`, `query-book-index`, `command-query-`, `command-mcp-` | Per-milestone agent index, the query tools (engine in `assets/theme/redocs-query.js`), `redocs query`, `redocs mcp` |
| Upgrade | `redocs-version`, `upgrade-migrations`, `command-upgrade-` | Skill version (from `package.json`), per-release migration steps (prose in [`CHANGELOG.md`](../skill/redocs/CHANGELOG.md)), `redocs upgrade`, check `RD014` |
| Artifacts | `command-embed-`, `load-plugin-registry` | Embedding and the plugin contract |
| Packaging | `command-pack-` | The zip |
| Shared | `shared-helpers` | Diagnostics, safe paths, stable JSON, hashing, HTML escaping |

## Other owners

| Concern | Owner |
|---|---|
| Book, page, entity, receipt, plugin, comment schemas | [`skill/redocs/schemas/`](../skill/redocs/schemas/) |
| Starter book used by `init` | [`skill/redocs/templates/book-starter/`](../skill/redocs/templates/book-starter/) |
| Reader theme (CSS variables, search, embeds, copy-for-AI, comments, Ask AI panel) | [`skill/redocs/assets/theme/`](../skill/redocs/assets/theme/) |
| Built-in plugins | [`skill/redocs/plugins/`](../skill/redocs/plugins/) |
| Check codes for authors | [`skill/redocs/references/check-codes.md`](../skill/redocs/references/check-codes.md) (kept in sync with `RULE_CODES` by a test) |
| Visual review helper | [`skill/redocs/scripts/screenshot-pages.mjs`](../skill/redocs/scripts/screenshot-pages.mjs) |
| file:// behaviour evidence | [`spikes/file-protocol/`](../spikes/file-protocol/) |
| Architecture, decisions and proposals with diagrams | [ReDocs design book](https://hdduytran.github.io/redocs-book/) |
