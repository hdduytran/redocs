# Comments and copy-for-AI

Two reader/reviewer features that stay inside ReDocs' constraints: the book is static HTML that
opens over `file://`, loads nothing remote, and builds reproducibly. Neither feature adds a
server, a network call, or build-time state.

## Comments (a review thread in the Git repo)

"Multiple people" commenting is modelled as **comments-as-source**: the review thread lives in the
book repository, so many authors contribute through commits or pull requests, and an agent reviews
with the same commands. It is asynchronous (synchronised by Git), not a live multi-user server — a
live server would need a backend and `fetch()`, which the architecture forbids.

### Storage

Comments live in `comments/<page-id>.jsonl`, one JSON object per line. A page id with slashes maps
to nested folders: comments for `network/topology` live in `comments/network/topology.jsonl`.

Each line:

```json
{"id": "c-1", "author": "Mai", "created": "2026-10-19T04:00:00Z", "body": "Is the cache write-through?", "anchor": "caching", "reply_to": null, "resolved": false}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable id, unique within the page thread (the CLI assigns `c-1`, `c-2`, …). |
| `author` | yes | Display name — a person or an agent. |
| `created` | yes | ISO-8601 timestamp. |
| `body` | yes | Comment text (plain/Markdown; rendered as escaped text with line breaks). |
| `anchor` | no | A heading slug on the page the comment is attached to. |
| `reply_to` | no | Id of the comment this one replies to (same thread). |
| `resolved` | no | `true` marks the thread head resolved. |

### CLI

```bash
redocs comment <book> <page-id> --author "Mai" --body "Is the cache write-through?"
redocs comment <book> <page-id> --author "Khoa" --body "Yes." --reply-to c-1
redocs comment <book> <page-id> --author "Mai" --body "See §caching" --anchor caching
redocs comment <book> <page-id> --resolve c-1          # mark resolved
redocs comment <book> <page-id> --resolve c-1 --reopen # reopen
redocs comment <book> [<page-id>] --list               # one page, or all pages
```

The build renders each page's thread into a **Comments** section under the page body: top-level
comments in file order, replies nested, resolved threads dimmed with a badge. `check` reports
`RD013` for a comments file that targets an unknown page, a reply to an unknown id, a duplicate id,
or an anchor that matches no heading.

### Why not live collaboration

A real-time, shared-server comment system (Supabase/Firebase + WebSocket) would break the "output
loads nothing remote / works offline over `file://`" boundary and the "no long-running process"
decision. If the book is ever published behind a server, that is a separate product decision, not a
feature of the static book. Local-only per-reader annotations (kept in `localStorage`) are a
possible lightweight addition but are not implemented; they would be private to one reader.

## Copy for AI

Every content page shows a split button in the page header. The main button copies **path +
content**; the `▾` menu copies other shapes. All of it is client-side JavaScript using
`navigator.clipboard` (a click is the user gesture it needs) with a `textarea`+`execCommand`
fallback, so it works over `file://` with no network.

The builder writes two inline blocks the script reads: `#rd-copy-meta` (JSON: `pageRef`, `title`,
`milestone`, `kind`, `entities`, `bookTitle`, `sourceFormat`) and `#rd-copy-source` (the page's own
Markdown/HTML source, HTML-escaped so a `</script>` in the source cannot break out).

| Menu item | Copies |
|---|---|
| Path + content (default) | `# page:<id>` header followed by the page's Markdown/HTML source |
| AI context block | A `--- redocs-context ---` header (page, title, book, milestone, kind, entities, format, url) + the source — paste straight into an LLM prompt |
| Content only | The source verbatim |
| Path only | `page:<id>` — the ReDocs reference, pasteable into another page |
| Citation link | `[title](page:<id>) · <milestone>` |
| Deep link | The current `file://` URL (keeps the section hash) |

The button is hidden until the script confirms it can copy, so a reader with scripting disabled
never sees a dead control.
