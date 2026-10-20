# Book model

A ReDocs book is a Git repository. Everything an agent needs to continue the work is in files.

```text
<book>/
├── AGENTS.md            rules for agents working on this book
├── book.json            title, language, milestones, chapters (page order), plugin settings
├── entities/*.json      registry: one array of entities per file (services.json, datastores.json, …)
├── pages/<chapter>/<page>/
│   ├── page.json        metadata (id, title, kind, variants, entities, owner, updated, sources)
│   └── index.md | index.html | <milestone>.md | <milestone>.html
├── artifacts/<id>/      spec.*, rendered output, receipt.json (written by `redocs embed`)
├── assets/              screenshots/, wireframes/, any static file referenced with asset:
├── site/                committed built site (only when book.json sets publish.dir)
└── dist/                build output (git-ignored)
```

Schemas: `<skill-dir>/schemas/*.schema.json`. Unknown fields are rejected except `x-*` keys.

## book.json

- `schemaVersion`: `1`.
- `redocsVersion`: the ReDocs version the book was written or last upgraded with (`init` stamps it; missing = `0.1.0`). Change it only through `redocs upgrade`.
- `id`: slug; `title`, optional `subtitle`, `description`; `language` (`vi`, `en`, …).
- `milestones`: chronological array of `{id, label, status, date?, description?}`; `status` ∈ `superseded | current | planned | target`, exactly one `current`.
- `chapters`: ordered `{id, title, pages: [page-id…]}`. Navigation follows this order; a page in no chapter is unreachable (RD002 warning).
- `plugins`: per-plugin settings, e.g. `{"archify": {"path": "~/.kiro/crew/skills/archify"}}`.
- `publish` (optional): `{"dir": "site"}` names a committed folder that mirrors `dist/`. When set, `redocs finalize` copies the built site into it after the browser check passes, so readers open `<dir>/index.html` straight from the repo and no one runs rsync by hand. `check` reports `RD015` when it is missing or stale. Omit it to keep `dist/`-only (git-ignored) behaviour.
- `chat` (optional, off by default): `{enabled, provider, model, endpoint, maxToolRounds, maxTokens}` for the reader's Ask AI panel; see agent-query-and-chat.md.

## page.json

| Field | Notes |
|---|---|
| `id` | Folder path under `pages/` (`network/topology`). Must match. |
| `title`, `kind` | `kind` is free-form lowercase; see page-kinds-and-templates.md. |
| `status` | `draft`, `review`, `accepted`, `rejected`, `superseded` (proposals use these). |
| `entry` | Shared source when there are no variants (default `index.md`, then `index.html`). |
| `variants` | `{milestone: file}`; see milestones-and-variants.md. |
| `standalone` | `true` for a complete HTML document shown in an iframe (own CSS/JS). Default: `.html` sources are fragments inside the book layout. |
| `entities` | Entity ids this page is about; listed in the footer and validated. |
| `owner`, `updated` (`YYYY-MM-DD`), `sources` (where facts came from), `tags`, `summary` | Shown in footer/home. Update `updated` when you edit. |

## Entities

```json
{ "id": "svc:billing", "type": "service", "name": "Billing service",
  "summary": "Invoices and payments", "owner": "payments-team",
  "tech": ["Go", "PostgreSQL"], "depends_on": ["db:billing", "svc:gateway"],
  "since": "v2", "until": "target", "replaced_by": "svc:payments",
  "links": [{"label": "Repo", "url": "https://..."}] }
```

- `id` = `<prefix>:<slug>`. Conventional prefixes: `svc` service, `db` datastore, `q` queue/stream, `ext` external system, `int` integration, `app` client app, `zone` network zone, `infra` infrastructure, `team`.
- `type` decides the catalog page (`catalog/<type>.html`) and file (`entities/<type>.json`, with the starter's plural names for service, datastore, integration, network-zone).
- Lifecycle: alive at milestone *m* when `since ≤ m < until` (milestone order from `book.json`). Omit `since` = from the first milestone; omit `until` = never removed. `replaced_by` requires `until`.

## Generated pages (never write these)

Per milestone: home, catalog (all + per type), **Changes A → B** (added/replaced/removed entities, pages with new variants) for each adjacent pair and for current → target, and **compare** views for every variant page that differs between those pairs.
