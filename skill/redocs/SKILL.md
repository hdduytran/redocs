---
name: redocs
description: Write and maintain an AI-authored "system design book" for a large system — vision, current architecture, proposals and target state across milestones (v1, v2, target) — as a Git repo of Markdown, HTML and embedded archify diagrams, built to static HTML that opens over file://. Use when the user asks for system/architecture documentation as a book, "ReDocs", "tài liệu hệ thống", a design book for microservices, data flows, integrations, network or infrastructure, a proposal page for a planned change, or to add a diagram, wireframe or screenshot to such a book.
license: MIT
metadata:
  version: "0.1.0"
---

# ReDocs

ReDocs turns the owner's instructions into a **system design book**: one Git repository per
system, readable by people as a static HTML book, maintained by agents through a CLI with a
deterministic quality gate. You write the content the owner asks for; ReDocs keeps structure,
cross-references, milestones and diagrams consistent.

Run the CLI with Node from any directory:

```bash
node <skill-dir>/bin/redocs.mjs <command> ...
```

`<skill-dir>` is the folder containing this file. Every command accepts `--json` for a machine
receipt. In a sandboxed agent shell where Chrome cannot start its own sandbox, prefix browser
work (`finalize`, `embed archify`) with `REDOCS_CHROME_NO_SANDBOX=1`.

## Contract

1. **Owner-led.** Write only what the owner said or what a source they pointed you to says. Unknowns become `> TODO(owner): <question>`; never invent architecture, numbers or roadmap.
2. **Read before writing**: the book's `AGENTS.md`, `book.json`, `entities/*.json`, then only the pages you will touch.
3. **Milestones are system states** (v1, v2, target), not document versions. Git keeps history; never copy pages to preserve old text.
4. **Done means `finalize` exits 0.** Report its summary (errors, warnings, pages, browser result). On failure, fix the reported source and rerun; never edit `dist/` or generated artifact HTML.
5. Touch only the files the request concerns; prefer the authoring commands, which keep `book.json` and `page.json` consistent.

## Intent router

| Owner asks to… | Do | Read |
|---|---|---|
| Start a book for a system | `init <dir> --name <id> --title "..." --language vi\|en`, then fill vision/overview from the owner's answers | [book-model.md](references/book-model.md) |
| Add or restructure chapters/pages | `add-page <book> <chapter>/<page> --title ... --kind ... [--chapter ...]` | [page-kinds-and-templates.md](references/page-kinds-and-templates.md) |
| Register a service, datastore, queue, integration, zone… | `add-entity <book> <prefix>:<slug> --type ... --name ... [--since/--until/--replaced-by]` | [book-model.md](references/book-model.md) |
| Describe a planned change (proposal) | proposal page + entity lifecycle + variants for the target milestone (recipe below) | [milestones-and-variants.md](references/milestones-and-variants.md) |
| Show how a page differs at a milestone | `add-variant <book> <page-id> <milestone>`, then edit the new file | [milestones-and-variants.md](references/milestones-and-variants.md) |
| Draw a diagram | write an archify spec (load the `archify` skill for its schema), `embed <book> archify <id> --spec f.json --type architecture\|workflow\|sequence\|dataflow\|lifecycle`, then reference it | [plugins-and-embeds.md](references/plugins-and-embeds.md) |
| Add a wireframe / mockup / other tool's HTML | `embed <book> html <id> --spec f.html` | [plugins-and-embeds.md](references/plugins-and-embeds.md) |
| Add a screenshot | copy into `assets/screenshots/`, reference `![caption](asset:screenshots/x.png)` | [plugins-and-embeds.md](references/plugins-and-embeds.md) |
| The system reached the next milestone | `promote <book> <milestone>`, then walk the review list with the owner | [milestones-and-variants.md](references/milestones-and-variants.md) |
| Comment on a page / review with others | `comment <book> <page-id> --author "..." --body "..."` (reply with `--reply-to`, close with `--resolve`); commit the `comments/` file | [comments-and-copy.md](references/comments-and-copy.md) |
| Validate / finish | `check <book>`, then `finalize <book>` | [check-codes.md](references/check-codes.md) |
| Share the book | `finalize`, then `pack <book>` (zip; readers open `index.html`) | — |

Writing rules for prose, language and structure: [writing-style.md](references/writing-style.md).

## Proposal recipe

For "we plan to split billing out of the monolith in v2":

1. Make sure milestone `v2` exists in `book.json` (add it in chronological order, status `planned`).
2. `add-page <book> proposals/split-billing --title "Split billing" --kind proposal --chapter proposals` and write context, decision, impact, alternatives, rollout.
3. `add-entity <book> svc:billing --type service --name "Billing" --since v2`; set `"until": "v2", "replaced_by": "svc:billing"` on what it replaces.
4. `add-variant <book> <affected-page> v2` for each page whose content changes; edit only what differs.
5. New diagram for v2: `embed <book> archify system-context-v2 --spec ... --type architecture` and embed it in the v2 variant.
6. `finalize`. The generated **Changes v1 → v2** page and the compare views now show the proposal's impact.

## Page syntax (Markdown and HTML fragments)

- Page link: `[text](page:network/topology#anchor)` — HTML: `href="page:..."`
- Entity: `[[svc:billing]]` or `[[svc:billing|label]]`
- Asset: `![caption](asset:screenshots/login.png)` — HTML: `src="asset:..."`
- Artifact (Markdown):
  ````text
  ```redocs-embed
  {"artifact": "system-context", "caption": "System context", "height": 700}
  ```
  ````
  HTML: `<redocs-embed artifact="system-context" height="700" caption="..."></redocs-embed>`

## Delivery report

State: what changed (files), `finalize` result (errors/warnings, pages, milestones, browser
pages and console errors), open `TODO(owner)` questions (RD011 warnings) and the path to
`dist/index.html`. If a plugin returned a notice (for example an archify update), relay it once.
Never claim visual review you did not do; `scripts/screenshot-pages.mjs <out> <page.html>...`
captures pages when a visual check is needed.
