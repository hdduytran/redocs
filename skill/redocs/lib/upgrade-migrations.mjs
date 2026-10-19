// What `redocs upgrade` does to a book for each skill release. CHANGELOG.md is the human
// version of this list; a test keeps the two in sync (every version and step id appears in it).
//
// A step is one of:
//   auto      applied by `upgrade --apply`; must be idempotent (needed() is false once done)
//   owner     needs the owner's words or decision; reported with the affected items, never applied
//   optional  a new capability the book may adopt; reported only while not adopted
//
// needed(ctx) -> false | true | {items: string[]}     apply(ctx) -> void (writes through ctx)
// ctx = { root, book, config, readText(rel), writeText(rel, text), exists(rel) }

const AGENTS_ROWS = [
  {
    marker: 'redocs query',
    after: /^\|\s*Validate\s*\|/,
    row: '| Find where something is described | `redocs query . search <words>`, then `redocs query . read page:<id>#<anchor>` (or `redocs mcp .` for an MCP client) |',
  },
  {
    marker: 'redocs upgrade',
    after: /^\|\s*Share\s*\|/,
    row: '| The skill was updated (`RD014` warning) | `redocs upgrade .` to see the plan, then `redocs upgrade . --apply` |',
  },
];

export const MIGRATIONS = [
  {
    version: '0.1.0',
    date: '2026-10-18',
    summary: 'First release: book model, check gate, milestones and variants, archify plugin, comments, copy-for-AI.',
    steps: [],
  },
  {
    version: '0.2.0',
    date: '2026-10-19',
    summary: 'Agent query tools (redocs query, redocs mcp), opt-in Ask AI chat, and redocs upgrade.',
    steps: [
      {
        id: 'agents-md-commands',
        kind: 'auto',
        title: 'Add `redocs query` and `redocs upgrade` to the commands table in AGENTS.md',
        needed(ctx) {
          if (!ctx.exists('AGENTS.md')) return false;
          const text = ctx.readText('AGENTS.md');
          return AGENTS_ROWS.some((r) => !text.includes(r.marker));
        },
        apply(ctx) {
          const lines = ctx.readText('AGENTS.md').split('\n');
          const missing = [];
          for (const r of AGENTS_ROWS) {
            if (lines.join('\n').includes(r.marker)) continue;
            const at = lines.findIndex((line) => r.after.test(line));
            if (at >= 0) lines.splice(at + 1, 0, r.row);
            else missing.push(r.row);
          }
          let text = lines.join('\n');
          if (missing.length) {
            // The owner reshaped AGENTS.md: append the rows instead of guessing where they go.
            text = `${text.replace(/\n*$/, '\n')}\n## Commands added by ReDocs 0.2.0\n\n| Task | Command |\n|---|---|\n${missing.join('\n')}\n`;
          }
          ctx.writeText('AGENTS.md', text);
        },
      },
      {
        id: 'page-summaries',
        kind: 'owner',
        title: 'Give pages a one-line "summary" in page.json: book_map, search and the Ask AI panel show it first',
        needed(ctx) {
          const items = [...ctx.book.pages.values()].filter((p) => !p.meta.summary).map((p) => p.metaFile).sort();
          return items.length ? { items } : false;
        },
      },
      {
        id: 'enable-chat',
        kind: 'optional',
        title: 'Optional: add the Ask AI panel with "chat": {"enabled": true} in book.json (readers bring their own model)',
        needed(ctx) {
          return !ctx.config.chat;
        },
      },
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
