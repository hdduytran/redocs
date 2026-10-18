# Plugins and embeds

Diagrams, wireframes and other generated visuals are **artifacts**: a spec you edit, an
output a plugin renders, and a receipt that proves the output matches the spec.

```text
artifacts/<id>/
├── spec.json | spec.html   the only file you edit
├── <id>.html               rendered output (never hand-edit)
└── receipt.json            ok, plugin, options, inputHash (sha256 of spec), output, title
```

`check` fails (RD007) when a receipt failed, the output is missing, or the spec changed after
the last render. Re-render one artifact with `embed` again, or every stale one with
`redocs embed <book> --refresh-stale`. A failed render keeps the previous output.

## Built-in plugins

| Plugin | Spec | Use for | Command |
|---|---|---|---|
| `archify` | archify JSON (`.json`) | architecture, workflow, sequence, dataflow, lifecycle diagrams | `redocs embed <book> archify <id> --spec f.json --type <type>` |
| `html` | complete HTML document (`.html`) | wireframes, mockups, exports from other AI documentation tools | `redocs embed <book> html <id> --spec f.html` |

**archify**: load the `archify` skill and follow its authoring path to write the spec (schema,
examples, `meta.quality_profile: "showcase"`). ReDocs runs archify's own `finalize` (validate,
deliver, strict check, browser check) in a scratch folder; a failing gate fails the embed with
archify's first diagnostic. Repair the spec following archify's repair guidance and embed again.
archify is found via `$REDOCS_ARCHIFY`, `book.json` `plugins.archify.path`, or
`~/.kiro/crew/skills/archify`. Relay any archify update notice once to the user; never update
it yourself.

One diagram per milestone when the picture changes: `system-context-v1`, `system-context-v2`,
each embedded in the matching page variant.

Lessons from dogfooding archify through ReDocs:

- archify's Viewer UI is built in for `en` and `zh-CN` only. For a Vietnamese (or other) book, keep diagram labels in English technical terms and explain them in the page prose.
- **Sequence** specs: keep messages at least 30px apart in `y`, keep participant labels short (about 10 characters; move detail to `sublabel`), and omit `meta.viewBox` so the canvas grows. Each of these was a separate failed gate in the first Kiro Crew diagram.
- An embed failure prints archify's first diagnostic; fix that one, run `redocs embed <book> --refresh-stale`, repeat.

**html**: the document must contain `<html>…</html>`, load nothing remote (RD009) and not use
`fetch()`/XHR. Keep wireframes low-fidelity and self-contained (inline CSS, inline SVG or
`data:` images).

## Embedding

Markdown:

````text
```redocs-embed
{"artifact": "system-context-v2", "caption": "System context at v2", "height": 700}
```
````

HTML fragment: `<redocs-embed artifact="login-wireframe" height="420" caption="Login"></redocs-embed>`

`height` is the maximum frame height in pixels (default 640); the frame shrinks to the
artifact's content and every embed gets an "Open full screen" link.

## Screenshots and other assets

Put files under `assets/` (for example `assets/screenshots/dashboard-v1.png`) and reference
them with `![Dashboard at v1](asset:screenshots/dashboard-v1.png)`. Check screenshots for
secrets, tokens and personal data before adding them.

## Book-defined plugins

A book may add `"plugins": {"<name>": {"manifest": "tools/<name>/plugin.json"}}`. The manifest
follows `schemas/plugin.schema.json` and names an adapter module exporting
`async render({specFile, outputFile, options, book, plugin})` that returns
`{ok, title?, error?, pluginVersion?, pluginReceipt?}`. Such plugins run code from the book
repository, so `embed` refuses them unless `--allow-book-plugins` is passed after the user
reviewed the code.
