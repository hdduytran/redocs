# Page kinds and templates

Pick the kind that matches the question the page answers. Kinds are labels (shown on the page
and in search), not enforced templates; keep headings consistent within a kind so readers and
compare views line up.

| Kind | Answers | Suggested sections |
|---|---|---|
| `vision` | Why does the system exist? | Problem · Outcome · Principles · Non-goals |
| `overview` | What is it, as a black box? | Summary · System context diagram · Key entities · Quality attributes |
| `service` | What does one service own? | Responsibilities · API surface · Data owned · Dependencies · Scaling & failure · Operations |
| `flow` | How does one journey/job run? | Trigger & actors · Sequence/workflow diagram · Steps · Failure & retries · Entities touched |
| `data` | Where does data live and move? | Stores · Dataflow/lineage diagram · Ownership · Retention · PII |
| `integration` | How do we talk to an external system? | Partner · Protocol & auth · Contracts · Limits · Failure handling |
| `network` / `infra` | Where does it run? | Accounts/regions · Network zones · Ingress/egress · Compute · Deploy path · Diagram |
| `proposal` | What do we plan to change? | Context · Decision · Impact (entities, milestones, pages) · Alternatives · Rollout · Open questions |
| `decision` | Why was X chosen (ADR)? | Status · Context · Decision · Consequences |
| `roadmap` | What comes when? | Milestones table · Themes per milestone · Dependencies |
| `runbook` | How do I operate it? | Symptoms · Checks · Actions · Escalation |
| `reference` / `glossary` | Lookup material | Tables, definitions |
| `wireframe` | What will the user see? | Embedded `html` artifact · Notes · States |

## Choosing a source format

- **Markdown (`.md`)** for prose, lists, tables and embeds. Default.
- **HTML fragment (`.html`, `standalone` false)** when the layout needs structure Markdown cannot express (grids, annotated callouts). It inherits the book styles; use the CSS variables of the theme (`var(--rd-surface)`, `var(--rd-border)`, …) instead of fixed colors so dark mode works.
- **Standalone HTML (`standalone: true`)** for a self-contained interactive page with its own scripts. It is shown in an iframe; it must not load remote resources (RD009) or call `fetch()`.
- Anything produced by a tool (diagrams, mockups) is an **artifact**, not a page source: see plugins-and-embeds.md.

## New system checklist

After `init`, ask the owner (one topic at a time) and fill: vision → system context (with an
architecture diagram) → entities registry → one page per important service → 3–5 key flows →
network/infra → proposals. Leave `TODO(owner)` where answers are missing; `check` lists them.
