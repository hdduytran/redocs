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

import { ciPipelineFiles } from './command-ci-pipelines.mjs';

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

// The "Published site" section `init` writes, reused verbatim by the 0.3.0 upgrade so a migrated
// book reads the same as a freshly scaffolded one.
const PUBLISHED_SITE_SECTION = `
## Published site

\`book.json\` sets \`"publish": { "dir": "site" }\`, so the built book lives in \`site/\` and is
**committed** — readers open \`site/index.html\` straight from the repository. You do not copy or
rsync it by hand:

- \`redocs finalize .\` rebuilds \`dist/\` and, when every check passes, refreshes \`site/\` for you.
- Commit the updated \`site/\` folder together with the sources you changed.
- \`dist/\` stays git-ignored; \`site/\` is the only built copy under version control.
- \`redocs check .\` reports \`RD015\` when \`site/\` is missing or older than the current sources, so a
  commit never ships a stale published site.
- A version tag (\`v*\`) triggers the release pipeline (\`.github/workflows/redocs-release.yml\` and
  \`.gitlab-ci.yml\`), which zips \`site/\` and attaches it to the release. Regenerate with
  \`redocs ci .\`.
`;

const README_TEMPLATE = (title, id) => `# ${title}

This repository is a **ReDocs system design book** for \`${title}\` (id \`${id}\`): the vision, the
current architecture, proposed changes and the target state, across milestones. It is written by AI
agents on the owner's instructions and read by people as a static HTML book.

## Read it

The built book is committed under [\`site/\`](site/). Open [\`site/index.html\`](site/index.html) in a
browser (it works over \`file://\`) — no build, no server.

## For agents

Agents working on this book follow [\`AGENTS.md\`](AGENTS.md). The book is maintained through the
\`redocs\` CLI, and a change is done only when \`redocs finalize .\` exits 0 — which also refreshes
\`site/\`.
`;

/** Add "publish": { "dir": "site" } before the "plugins" key, or before the final brace. Text edit so the owner's formatting is kept. */
function addPublishToBookJson(text) {
  if (/"publish"\s*:/.test(text)) return text;
  const line = '  "publish": { "dir": "site" },';
  if (/^([ \t]*)"plugins"\s*:/m.test(text)) {
    return text.replace(/^([ \t]*)"plugins"\s*:/m, `${line.replace(/^ {2}/, '$1')}\n$1"plugins":`);
  }
  // No plugins key: insert before the closing brace of the top-level object.
  return text.replace(/\n(\}\s*)$/, (m, brace) => {
    const needsComma = /[^\s,{]\s*$/.test(text.slice(0, text.lastIndexOf('}')));
    return `${needsComma ? ',' : ''}\n${line}\n${brace}`;
  });
}

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
  {
    version: '0.3.0',
    date: '2026-10-20',
    summary: 'Committed, self-updating published site: book.json "publish.dir", finalize keeps it in sync, RD015 staleness check, README for readers.',
    steps: [
      {
        // Reported as [optional] in the plan (it adopts a new capability) but written by --apply,
        // because every part is idempotent and non-destructive: books created before 0.3.0 get the
        // publish config, a reader README and the AGENTS "Published site" section in one pass, and
        // the hand-run rsync step is replaced by `redocs finalize`.
        id: 'publish-site',
        kind: 'auto',
        title: 'Add "publish": {"dir": "site"} to book.json, a reader README.md, and the "Published site" section in AGENTS.md',
        needed(ctx) {
          const items = [];
          if (!ctx.config.publish) items.push('book.json: add "publish": { "dir": "site" }');
          if (!ctx.exists('README.md')) items.push('README.md: create a reader-facing README');
          if (ctx.exists('AGENTS.md') && !ctx.readText('AGENTS.md').includes('## Published site')) items.push('AGENTS.md: add the "Published site" section');
          return items.length ? { items } : false;
        },
        apply(ctx) {
          if (!ctx.config.publish) ctx.writeText('book.json', addPublishToBookJson(ctx.readText('book.json')));
          if (!ctx.exists('README.md')) {
            ctx.writeText('README.md', README_TEMPLATE(ctx.config.title || ctx.config.id, ctx.config.id));
          }
          if (ctx.exists('AGENTS.md')) {
            const text = ctx.readText('AGENTS.md');
            if (!text.includes('## Published site')) ctx.writeText('AGENTS.md', `${text.replace(/\n*$/, '\n')}${PUBLISHED_SITE_SECTION}`);
          }
        },
      },
      {
        // Release pipelines for GitHub and GitLab that zip the committed publish folder on a version
        // tag. Written by --apply; each file is only created when absent, so an owner's own pipeline
        // is never overwritten.
        id: 'ci-pipelines',
        kind: 'auto',
        title: 'Add GitHub (.github/workflows/redocs-release.yml) and GitLab (.gitlab-ci.yml) release pipelines that attach the book zip to a tag release',
        needed(ctx) {
          const items = [];
          if (!ctx.exists('.github/workflows/redocs-release.yml')) items.push('.github/workflows/redocs-release.yml');
          if (!ctx.exists('.gitlab-ci.yml')) items.push('.gitlab-ci.yml');
          return items.length ? { items } : false;
        },
        apply(ctx) {
          // Only the missing files, written through ctx so upgrade reports them in changedFiles.
          const publishRel = ctx.config.publish?.dir || 'site';
          for (const file of ciPipelineFiles(ctx.config.id, publishRel, 'both')) {
            if (!ctx.exists(file.path)) ctx.writeText(file.path, file.content);
          }
        },
      },
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
