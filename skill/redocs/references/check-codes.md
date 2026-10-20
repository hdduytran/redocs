# Check codes

`redocs check` and `redocs finalize` report diagnostics as
`SEVERITY CODE file pointer|line: message` (or JSON with `--json`). Fix errors at the source
named in `file`; never edit `dist/`.

| Code | Severity | Meaning | Usual fix |
|---|---|---|---|
| RD000 | error | A JSON file cannot be read or parsed. | Fix the JSON syntax. |
| RD001 | error | Schema violation in `book.json`, `page.json`, `entities/*.json` or a receipt; also a page id that differs from its folder, or a duplicate entity id. | Follow the `pointer`; schemas live in the skill's `schemas/`. |
| RD002 | error / warning | A chapter lists an unknown page or lists a page twice (error); a page is in no chapter (warning: readers cannot reach it). | `redocs add-page`, or edit `chapters` in `book.json`. |
| RD003 | error | `page:` link to an unknown page, or `#anchor` not found on the target page at that milestone. | Use the page id (`chapter/page`) and an anchor from the hint list. |
| RD004 | error | `[[id]]` or `page.json` `entities` names an entity that is not registered. | `redocs add-entity`, or fix the id. |
| RD005 | error | A milestone-specific variant mentions an entity that does not exist at that milestone. Shared pages (no variants) may mention future or removed entities; they get a badge instead. | Fix `since`/`until`, or move the text to the right variant. |
| RD006 | error / warning | A variant names an unknown milestone, or a page source file is missing (errors); a `.md`/`.html` file in the page folder that the page never renders, e.g. `index.md` shadowing `index.html` (warning). | Fix `variants`/`entry` in `page.json`, create the file, or delete the stray one. |
| RD007 | error / warning | An embed names an unknown artifact or is invalid JSON; a receipt is missing, failed, or older than its `spec.*` (stale); output file missing (errors). An artifact embedded nowhere (warning). | `redocs embed ...` again, or `redocs embed <book> --refresh-stale`. |
| RD008 | error | `asset:` reference to a file that is not under `assets/`. | Add the file or fix the path. |
| RD009 | error | A page or HTML artifact loads a remote script, stylesheet, image, iframe or media. The book must work offline over `file://`. | Download it into `assets/` and use `asset:...`. Plain `<a href="https://...">` links are fine. |
| RD010 | error | Entity graph: unknown `depends_on`/`replaced_by` target, `replaced_by` without `until`, unknown milestone in `since`/`until`, or `since` not before `until`. | Fix the entity in `entities/`. |
| RD011 | warning | An open `TODO(owner)` question remains on a page. | Ask the owner; replace the marker with the answer. |
| RD012 | error | Not exactly one milestone has status `current`, or milestone/chapter ids repeat. | `redocs promote <book> <milestone>`, or fix `book.json`. |
| RD013 | error / warning | A comments file targets an unknown page, a comment replies to an unknown id, or two comments share an id (errors); a comment is anchored to a heading that no longer exists (warning). | Rename/fix `comments/<page-id>.jsonl`, or re-anchor the comment. |
| RD014 | warning / error | `book.json` `redocsVersion` is older than the skill (warning: the book has not been upgraded; missing = 0.1.0) or newer (error: update the skill). | `redocs upgrade <book>`, review the plan, then `redocs upgrade <book> --apply`. |
| RD015 | warning | `book.json` sets `publish.dir` but that folder is missing, or it was built from sources that have since changed (stale). | `redocs finalize <book>` to rebuild and refresh the published folder, then commit it. |

`--strict` turns warnings into a failed result. `finalize` additionally fails when the
file:// browser check sees a console error, a failed resource load or a page that does not
load; its receipt is written to `dist/finalize-receipt.json`.
