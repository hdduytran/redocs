# {{BOOK_TITLE}}

This repository is a **ReDocs system design book** for `{{BOOK_TITLE}}` (id `{{BOOK_ID}}`): the
vision, the current architecture, proposed changes and the target state, across milestones. It is
written by AI agents on the owner's instructions and read by people as a static HTML book.

## Read it

The built book is committed under [`site/`](site/). Open it straight from a checkout — no build,
no server:

- Open [`site/index.html`](site/index.html) in a browser (it works over `file://`).

Each milestone (for example v1 and target) has its own home page; the milestone switcher at the top
of every page moves between them.

## What is inside

| Path | What it holds |
|---|---|
| `book.json` | Title, language, milestones and chapter/page order |
| `entities/` | The registry of services, datastores, integrations and network zones |
| `pages/` | The chapters and pages (Markdown or HTML) |
| `artifacts/` | Diagrams and embedded documents, with the spec they were rendered from |
| `assets/` | Screenshots and other static files |
| `site/` | The built HTML book, committed so it can be read without a build |

`dist/` is a scratch build folder and is **not** committed; `site/` is the published copy that is.

## For agents

Agents working on this book follow [`AGENTS.md`](AGENTS.md): read it before editing. In short, the
book is maintained through the `redocs` CLI, and a change is done only when `redocs finalize .`
exits 0 — which also refreshes `site/`.
