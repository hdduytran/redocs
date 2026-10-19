# Changelog

Each release below lists what changed in the skill and what `redocs upgrade` does to an
existing book. Step kinds:

- **auto**: applied by `redocs upgrade <book> --apply`.
- **owner**: needs the owner's words. It is reported and never written.
- **optional**: a new capability the book may adopt.

The machine-readable version is `lib/upgrade-migrations.mjs`. A test keeps the two in sync.

## 0.2.0 — 2026-10-19

### Added
- Agent query tools over a per-milestone index (chapter map, h1–h3 sections, entity graph,
  change sets): `book_map`, `book_outline`, `book_search` (BM25, accent-insensitive),
  `book_read`, `book_entity`, `book_changes`, `book_citations`.
- `redocs query <book> <tool>` runs them from the terminal; `redocs mcp <book>` serves them over
  stdio for MCP clients.
- Opt-in Ask AI panel (`book.json` `chat`). The reader brings their own model: Anthropic or an
  OpenAI-compatible server such as vLLM or Ollama. The panel streams replies, offers a
  `/v1/models` picker, docks to the side and is resizable, and keeps conversation history in the
  browser.
- `redocs upgrade` and the `book.json` field `redocsVersion`. New books are stamped with it.
- Check `RD014`: the book is older than the skill (warning) or newer (error).

### Upgrade steps
- auto `agents-md-commands`: add `redocs query` / `redocs mcp` and `redocs upgrade` to the
  commands table in `AGENTS.md`. If the owner reshaped the table, the rows are appended under a
  new heading instead.
- owner `page-summaries`: pages without a one-line `summary` in `page.json` are listed.
  `book_map`, search and the Ask AI panel show the summary first, so ask the owner for one.
  Without it, the first paragraph is used.
- optional `enable-chat`: set `"chat": {"enabled": true}` in `book.json` to add the Ask AI panel.
- Every upgrade stamps `"redocsVersion"` in `book.json`.

## 0.1.0 — 2026-10-18

First release: book model and schemas, `init` / `add-*` / `promote`, the check gate (RD000–RD013),
static build that works over `file://`, milestones and variants with compare/changes pages,
plugin contract with archify and HTML artifacts, comments-as-source and copy-for-AI.

### Upgrade steps
None. A book without `redocsVersion` is treated as 0.1.0.
