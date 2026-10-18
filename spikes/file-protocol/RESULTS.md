# Spike: file:// behaviour (2026-10-18)

Harness: `REDOCS_CHROME_NO_SANDBOX=1 node spikes/file-protocol/run-chrome-spike.mjs`
(headless Chrome 155 over `--remote-debugging-pipe`, throwaway profile, no file:// relaxing flags).

| # | Behaviour | Chrome 155 (headless, automated) | Safari (manual) |
|---|---|---|---|
| 1 | iframe with relative `src` to a local file loads | PASS | pending user check |
| 1b | parent reads `iframe.contentDocument` | FAIL (opaque origin, expected) | pending |
| 2 | `postMessage(..., '*')` from iframe → parent resize | PASS (archify sample reported h=1050) | pending |
| 3 | data via `<script src>` (`window.__REDOCS_SEARCH`) | PASS | pending |
| 3b | offline search over that data | PASS | pending |
| 4 | `localStorage` read/write | PASS | pending |
| 5 | `fetch()` of a local file | FAIL — blocked by CORS (expected; proves the rule) | pending |
| 6 | relative links across folders (`sub/`, `../`) + `<script src="../...">` | PASS | pending |
| 7 | `<meta http-equiv="refresh">` redirect | PASS (landed on `sub/page.html`) | pending |

Safari check: `open -a Safari spikes/file-protocol/index.html`; the page lists PASS/FAIL itself.

## Decisions

- Runtime data (search index, manifest) is loaded only through `<script src>`; `fetch()`/XHR are forbidden in output and `check` treats a fetch console error as a failure.
- Embeds: iframe + injected resize script posting `{type:'redocs:height', h}`; parent verifies `event.source`, clamps height (min 300, max 900 by default, overridable per embed with `height`), and always renders an "Open full screen" link to the artifact file.
- Theme: `localStorage` when available, falling back to `prefers-color-scheme`.
- `dist/index.html` uses meta refresh (plus a visible link) to the current milestone.
- Browser check: pipe transport, no WebSocket/port. Inside sandboxed agent shells Chrome's own sandbox cannot start (`sandbox initialization failed: Operation not permitted`), so `REDOCS_CHROME_NO_SANDBOX=1` is an explicit opt-out; it does not change file:// policy.
- The checker correctly surfaced the deliberate `fetch()` failure as a console error + failed request, so it is fit to be the `finalize` browser gate.
