# Changelog

Each release below lists what changed in the skill and what `redocs upgrade` does to an
existing book. Step kinds:

- **auto**: applied by `redocs upgrade <book> --apply`.
- **owner**: needs the owner's words. It is reported and never written.
- **optional**: a new capability the book may adopt.

The machine-readable version is `lib/upgrade-migrations.mjs`. A test keeps the two in sync.

## 0.3.0 — 2026-10-20

### Added
- Committed published site: `book.json` `publish.dir` (e.g. `"publish": {"dir": "site"}`) names a
  folder that travels with the repo as a pre-built copy of the book. When set, `redocs finalize`
  copies `dist/` into it after the build and the file:// browser check pass, so no one runs rsync
  by hand. Omit `publish` to keep the old behaviour (`dist/` only, git-ignored).
- `dist/_redocs/build.json`: a deterministic stamp of the source hash the site was built from.
- Check `RD015`: the published site is missing, or stale because the sources changed after it was
  built (warning), so a commit never ships a published site nobody rebuilt.
- `redocs pack` zips the committed publish folder when one is configured, else `dist/`.
- Finalize receipt records `build.dist` as a book-relative path (no absolute machine path), so it
  is safe to pack and to commit inside the published site.
- New books scaffold a reader-facing `README.md`, a `"publish": {"dir": "site"}` in `book.json`,
  and a "Published site" section in `AGENTS.md`.
- `redocs ci <book> [--provider github|gitlab|both]` writes a release pipeline that, on a version
  tag (`v*`), zips the committed publish folder and attaches it to the GitHub/GitLab release. New
  books get both pipelines at `init`. The pipeline needs no Node or ReDocs on CI — it zips the
  already-built `site/` and fails fast if that folder is missing.

### Upgrade steps
- auto `publish-site`: add `"publish": {"dir": "site"}` to `book.json`, create a reader `README.md`
  (only if absent), and add the "Published site" section to `AGENTS.md`. Reported as optional in
  the plan because it adopts a new capability, but written by `--apply` since every part is
  idempotent and non-destructive. After it, `redocs finalize` replaces the hand-run rsync step.
- auto `ci-pipelines`: add `.github/workflows/redocs-release.yml` and `.gitlab-ci.yml` (each only
  when absent) so a version tag releases the book zip. Owner-authored pipelines are never
  overwritten.

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
