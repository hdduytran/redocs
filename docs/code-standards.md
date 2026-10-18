# Code standards

Engineering rules that the code alone does not explain. Formatting follows the surrounding code.

## Runtime and dependencies

- Node ≥ 18 (`engines` in [`skill/redocs/package.json`](../skill/redocs/package.json)), ES modules, no build step and no framework.
- Runtime dependencies are pinned to exact versions and kept few. Add one only when the alternative is re-implementing a well-specified format (Markdown, JSON Schema, zip).
- The browser check talks CDP itself; do not add Puppeteer or Playwright as a dependency.

## Behavioural invariants

- **Content problems are diagnostics, not exceptions.** Use `diagnostic()` from `lib/shared-helpers.mjs` with a stable `RDxxx` code, the book-relative `file`, a `pointer` or `line`, and a `hint` an agent can act on. Throw `RedocsError` only for unusable input (no `book.json`, bad CLI arguments, unsafe paths).
- **New check codes** go into `RULE_CODES` and [`references/check-codes.md`](../skill/redocs/references/check-codes.md) together; a test fails when the two disagree.
- **Determinism**: no timestamps or random values in `dist/` or receipts; iterate in sorted order. The build tests compare `distHash` across two builds.
- **Offline output**: no `fetch()`, no remote resources, relative URLs only. Build tests scan every generated file for this.
- **Paths**: resolve book-relative paths with `resolveInside()`; never delete or write outside the book directory or the scratch directory.
- **Subprocesses**: use `execFile`/`spawn` with argument arrays, never a shell string, and always clean up what you start (Chrome processes, temp profiles, scratch folders) in `finally`.
- **Escaping**: every value placed into HTML goes through `escapeHtml()`; Markdown runs with `html: true` because authors are trusted, metadata is not.
- **Agent-facing text** (`SKILL.md`, `references/`, CLI summaries) is part of the product. Change it with the behaviour it describes.

## Naming

Long, descriptive kebab-case file names (`render-markdown-with-redocs-extensions.mjs`) so search tools find the owner. Keep modules near 200 lines; split on real boundaries, not line counts.

## Testing

- `node:test`, run sequentially (the `test` script passes `--test-concurrency=1`).
- Test books are created fresh from the starter with the helpers in `test/helpers/`; never point tests at a real book.
- Every check rule has a broken fixture that must produce its code, and the clean starter must produce no errors.
- Tests that need Chrome or archify skip with a reason when either is missing; they run for real when present. Do not mock them away.
- Inside a sandboxed agent shell Chrome cannot start its own sandbox: set `REDOCS_CHROME_NO_SANDBOX=1` for the test run. It does not relax file:// policy.
- While iterating, run the affected suite (`node --test <path-to-test-file>`); run the whole suite before handing over.
- Visual changes to the theme or shell need a look at real pages: build a book and use `scripts/screenshot-pages.mjs`, in light and dark mode.

## Reader interface

Theme colours are CSS variables in [`assets/theme/redocs.css`](../skill/redocs/assets/theme/redocs.css), defined for light and dark; pairs must meet WCAG AA contrast. New UI keeps landmarks, visible focus and keyboard access, and must work without `localStorage`.
