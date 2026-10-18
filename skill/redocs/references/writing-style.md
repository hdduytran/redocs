# Writing style

The book is read by stakeholders before a decision and by developers who receive the work.
Write so that either can act on a page without asking.

- **Language**: write in `book.json` `language`. Keep technical terms, product names, API paths and code identifiers in English (for Vietnamese books: "service `billing` gọi `gateway` qua gRPC").
- **Lead with the answer.** First paragraph: what this page decides or describes, in two or three sentences.
- **One page, one question.** Split when a page answers two (for example a service page that also describes a migration → move the migration to a proposal).
- **Name things through the registry.** Mention every component as `[[id]]` the first time on a page; afterwards plain names are fine.
- **Facts carry their source.** Add where a fact came from to `page.json` `sources` (doc path, repo, meeting with whom). If the owner gave it verbally, write "owner, <date>".
- **Unknowns are questions, not guesses.** `> TODO(owner): Which region hosts the DR copy?` One question per marker.
- **Numbers need units and dates** ("p95 120 ms, measured 2026-09").
- **Diagrams explain, text decides.** Every embedded diagram gets a caption and one or two sentences saying what to notice.
- **Proposals are reviewable.** State the decision in one sentence, then impact, alternatives with why they lost, rollout steps a team can execute, and open questions. Set `status` (`draft` → `review` → `accepted`/`rejected`).
- **Keep variants diff-friendly.** Same headings across a page's variants; change only what differs.
- **Accessibility**: descriptive link text (not "here"), alt text on images, table headers, no information conveyed by color alone in HTML pages or wireframes.
