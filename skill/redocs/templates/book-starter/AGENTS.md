# AGENTS.md: how to work on this ReDocs book

This repository is a **ReDocs system design book** for `{{BOOK_TITLE}}` (id `{{BOOK_ID}}`).
AI agents write and update it **on the book owner's instructions**. People read the built HTML.

## Read before writing

1. `book.json`: chapters, page order, **milestones** (architecture states such as v1, v2, target; exactly one is `current`).
2. `entities/*.json`: the registry of services, datastores, integrations, network zones and so on. Every thing the book names lives here once.
3. The `page.json` and source files of the pages you were asked to touch, plus the pages they link to.

## Rules

- Write only what the owner told you or what a source they pointed to says. When something is unknown, write `> TODO(owner): ...` instead of guessing.
- Write in the book language (`language` in `book.json`); keep technical terms in English.
- Milestones are **system states**, not document versions. Git holds the edit history; never copy pages to keep old versions.
- Reference entities as `[[svc:billing]]`, other pages as `[text](page:chapter/page)`, assets as `![caption](asset:screenshots/x.png)`, artifacts with a `redocs-embed` block.
- A change that adds, removes or replaces a component updates `entities/` (`since`, `until`, `replaced_by`) **and** the affected pages' variants for that milestone.
- Diagrams are artifacts produced by plugins (archify). Edit the spec, then run `redocs embed ...` again; never hand-edit generated HTML.
- Keep changes minimal: touch only the files the instruction concerns.

## Commands

The `redocs` CLI ships with the ReDocs skill: `node <skill>/bin/redocs.mjs <command>`.

| Task | Command |
|---|---|
| Add a page | `redocs add-page . <chapter>/<page> --title "..." --kind <kind> --chapter <chapter>` |
| Add an entity | `redocs add-entity . svc:<name> --type service --name "..." [--since v2]` |
| Add a milestone variant | `redocs add-variant . <page-id> <milestone>` |
| Embed a diagram | `redocs embed . archify <artifact-id> --spec <file.json> --type architecture` |
| Validate | `redocs check .` |
| Find where something is described | `redocs query . search <words>`, then `redocs query . read page:<id>#<anchor>` (or `redocs mcp .` for an MCP client) |
| **Finish** | `redocs finalize .` (check, build and the file:// browser check) |
| Share | `redocs pack .` (zip of the built site) |
| The skill was updated (`RD014` warning) | `redocs upgrade .` to see the plan, then `redocs upgrade . --apply` |

Work is done only when `redocs finalize .` exits 0. Report the receipt summary, not a guess.

## Published site

`book.json` sets `"publish": { "dir": "site" }`, so the built book lives in `site/` and is
**committed** — readers open `site/index.html` straight from the repository. You do not copy or
rsync it by hand:

- `redocs finalize .` rebuilds `dist/` and, when every check passes, refreshes `site/` for you.
- Commit the updated `site/` folder together with the sources you changed.
- `dist/` stays git-ignored; `site/` is the only built copy under version control.
- `redocs check .` reports `RD015` when `site/` is missing or older than the current sources, so a
  commit never ships a stale published site.
- A version tag (`v*`) triggers the release pipeline (`.github/workflows/redocs-release.yml` and
  `.gitlab-ci.yml`), which zips `site/` and attaches it to the release. Regenerate with
  `redocs ci .`.
