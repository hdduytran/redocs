# Milestones and variants

## Concepts

- A **milestone** is a state of the system: `v1` (what runs today), `v2` (next planned state), `target` (long-term). Declared once in `book.json`, in chronological order, exactly one `current`.
- The site is built once per milestone (`dist/<milestone>/…`). Readers switch milestone from the header; `dist/index.html` opens the current one.
- A **shared page** (no `variants`) shows the same body at every milestone. Vision, glossary and proposals are usually shared. Entity chips on shared pages show a badge ("from v2", "removed in target") instead of failing.
- A **variant page** has `"variants": {"v1": "v1.md", "v2": "v2.md"}`. At a milestone without its own variant, the page shows the nearest earlier variant with an "inherited from" notice; before its first variant it shows "does not exist yet". Variant bodies are checked strictly: every entity they mention must be alive at that milestone (RD005).
- Document history is **Git**, never milestones. Tag the repo when you share a version (`git tag book-2026-10`).

## Commands

```bash
redocs add-variant <book> network/topology v2   # copies the inherited body into v2.md; edit only what differs
redocs add-page <book> data/pipeline --title "Pipeline" --kind data --variants v1,target
redocs promote <book> v2                        # v2 becomes current, v1 superseded; prints what to review
```

`add-variant` on a shared page first renames its entry to the current milestone's variant.

## Adding a milestone

Edit `book.json` and insert it in chronological order with status `planned` (or `target` for
the long-term end state). Then add variants and entity lifecycles for it. Keep the headings of
a page identical across its variants so the compare view lines up.

## What readers get for free

- Milestone switcher on every page (same page, other milestone).
- **Changes A → B**: entities added, replaced (with their replacement) and removed, plus pages with new content and links to compare views. Generated for each adjacent pair and for current → target.
- **Compare A ↔ B**: two columns with the page at both milestones.
- Catalog per milestone: alive entities first, the rest under "Not at this milestone".

## Lifecycle cheat sheet

| Situation | Entity fields |
|---|---|
| Exists today and stays | (no `since`/`until`) |
| New in v2 | `"since": "v2"` |
| Removed in target | `"until": "target"` |
| Replaced in v2 by svc:new | old: `"until": "v2", "replaced_by": "svc:new"`; new: `"since": "v2"` |
