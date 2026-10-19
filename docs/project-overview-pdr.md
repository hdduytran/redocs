# Project overview

ReDocs is a skill that lets an AI agent, guided by a system's owner, write and maintain a
**system design book**: vision, current architecture, proposals and target state of a large
system, built to static HTML that a reader opens straight from disk.

The installable skill lives in [`skill/redocs/`](../skill/redocs/); its agent-facing contract is
[`skill/redocs/SKILL.md`](../skill/redocs/SKILL.md). This repository is where the skill is
developed. Books written with it live in their own repositories.

## Intent

These decisions were set by the owner when the project started and shape everything else:

| Question | Decision |
|---|---|
| Who writes, who reads | The agent writes on the owner's instructions; the book is for people. |
| Where a book lives | One Git repository per documented system, never inside a code repository. |
| When it changes | Only when the owner asks. Books may describe systems that do not exist yet. |
| Formats | Markdown for prose, HTML where layout matters, embedded artifacts from AI documentation tools (archify first). |
| How it is read | Opened over `file://`, shareable as a zip. No server. |
| Versioning | Milestones are architecture states; document history is Git. |

"AI native" means four things, in this order of importance: the agent is the authoring
interface; the book has a machine-readable model the agent reads first; a deterministic gate
decides when work is done; tools plug in through one artifact contract.

## Non-goals

Multi-author collaboration, a server or hosting, authentication, syncing from source code,
generating diagrams from the entity registry, WYSIWYG editing. A chatbot inside the book exists
only as the opt-in, bring-your-own-model Ask AI panel; ReDocs hosts no LLM and no proxy.

## Terminology

| Term | Meaning |
|---|---|
| Book | A repository with `book.json` at its root. |
| Milestone | A state of the documented system (`v1`, `v2`, `target`), declared once per book; exactly one is `current`. Not a document version. |
| Variant | A page body specific to one milestone. Pages without variants are shared by all milestones. |
| Entity | A registered component (service, datastore, zone…) with a lifecycle `since` / `until` / `replaced_by`. |
| Artifact | Tool-generated content: a spec the agent edits, an output a plugin renders, and a receipt. |
| Receipt | `receipt.json` recording the plugin result and the spec hash, so stale output is detectable. |
| Owner question | A `TODO(owner)` marker; the agent writes one instead of guessing. |

## Constraints

- Output must work over `file://`: no `fetch()`, no remote resources, relative links only. The evidence is in [`spikes/file-protocol/RESULTS.md`](../spikes/file-protocol/RESULTS.md).
- The agent writes only what the owner said or what a named source says.
- Work is done only when `redocs finalize` exits 0.

Planned direction is tracked as a proposal in the
[ReDocs design book](https://hdduytran.github.io/redocs-book/) (page *Proposal: phase 2*), not here.
