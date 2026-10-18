#!/usr/bin/env node
// ReDocs CLI. Every command prints a human summary, or a JSON receipt with --json.
// Exit codes: 0 ok, 1 content/check failure, 2 usage error.

import { RedocsError } from '../lib/shared-helpers.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'force', 'html', 'standalone', 'strict', 'skip-browser', 'allow-skip-browser', 'refresh-stale', 'allow-book-plugins', 'help']);
const LIST_FLAGS = new Set(['variants', 'depends-on', 'tech']);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawKey, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (BOOLEAN_FLAGS.has(rawKey)) {
      flags[rawKey] = inline === undefined ? true : inline !== 'false';
      continue;
    }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new RedocsError(`--${rawKey} needs a value`, { code: 'ERR_REDOCS_USAGE' });
    flags[rawKey] = LIST_FLAGS.has(rawKey) ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;
  }
  return { positionals, flags };
}

const USAGE = `ReDocs: AI-authored system design books, built to static HTML that opens over file://

Usage: redocs <command> [args] [--json]

  init <dir> --name <id> [--title "..."] [--language en|vi] [--force]
  add-page <book> <page-id> --title "..." --kind <kind> [--chapter <id>] [--chapter-title "..."]
           [--variants v1,v2] [--html] [--standalone]
  add-entity <book> <entity-id> --type <type> --name "..." [--summary "..."] [--owner ...]
           [--since <m>] [--until <m>] [--replaced-by <id>] [--depends-on a,b] [--tech a,b]
  add-variant <book> <page-id> <milestone>
  promote <book> <milestone>
  embed <book> <plugin> <artifact-id> --spec <file> [--type <archify-type>] [--title "..."]
  embed <book> --refresh-stale
  check <book> [--strict]
  build <book> [--out <dir>]
  pack <book> [--out <file.zip>]
  finalize <book> [--strict] [--skip-browser --allow-skip-browser]

Environment: REDOCS_CHROME (browser path), REDOCS_CHROME_NO_SANDBOX=1, REDOCS_ARCHIFY (archify skill dir).`;

function need(value, label) {
  if (!value) throw new RedocsError(`Missing ${label}`, { code: 'ERR_REDOCS_USAGE' });
  return value;
}

const COMMANDS = {
  async init({ positionals: [dir], flags }) {
    const { initBook } = await import('../lib/command-init-book.mjs');
    return initBook({ dir: need(dir, '<dir>'), name: flags.name, title: flags.title, language: flags.language, force: flags.force });
  },
  async 'add-page'({ positionals: [book, id], flags }) {
    const { addPage } = await import('../lib/command-add-page-entity-variant.mjs');
    return addPage({ book: need(book, '<book>'), id: need(id, '<page-id>'), title: flags.title, kind: flags.kind, chapter: flags.chapter, chapterTitle: flags['chapter-title'], variants: flags.variants, html: flags.html, standalone: flags.standalone });
  },
  async 'add-entity'({ positionals: [book, id], flags }) {
    const { addEntity } = await import('../lib/command-add-page-entity-variant.mjs');
    return addEntity({ book: need(book, '<book>'), id: need(id, '<entity-id>'), type: flags.type, name: flags.name, summary: flags.summary, owner: flags.owner, since: flags.since, until: flags.until, replacedBy: flags['replaced-by'], dependsOn: flags['depends-on'], tech: flags.tech });
  },
  async 'add-variant'({ positionals: [book, page, milestone] }) {
    const { addVariant } = await import('../lib/command-add-page-entity-variant.mjs');
    return addVariant({ book: need(book, '<book>'), page: need(page, '<page-id>'), milestone: need(milestone, '<milestone>') });
  },
  async promote({ positionals: [book, milestone] }) {
    const { promoteMilestone } = await import('../lib/command-promote-milestone.mjs');
    return promoteMilestone({ book: need(book, '<book>'), milestone: need(milestone, '<milestone>') });
  },
  async embed({ positionals: [book, plugin, artifactId], flags }) {
    const { embedArtifact, refreshStaleArtifacts } = await import('../lib/command-embed-artifact.mjs');
    if (flags['refresh-stale']) return refreshStaleArtifacts({ book: need(book, '<book>'), allowBookPlugins: flags['allow-book-plugins'] });
    return embedArtifact({ book: need(book, '<book>'), plugin: need(plugin, '<plugin>'), artifactId: need(artifactId, '<artifact-id>'), spec: need(flags.spec, '--spec'), options: { type: flags.type }, title: flags.title, allowBookPlugins: flags['allow-book-plugins'] });
  },
  async check({ positionals: [book], flags }) {
    const { checkBook } = await import('../lib/command-check-book.mjs');
    return checkBook({ book: need(book, '<book>'), strict: flags.strict });
  },
  async build({ positionals: [book], flags }) {
    const { buildBook } = await import('../lib/command-build-book-site.mjs');
    return buildBook({ book: need(book, '<book>'), out: flags.out });
  },
  async pack({ positionals: [book], flags }) {
    const { packBook } = await import('../lib/command-pack-book-zip.mjs');
    return packBook({ book: need(book, '<book>'), out: flags.out });
  },
  async finalize({ positionals: [book], flags }) {
    const { finalizeBook } = await import('../lib/command-finalize-book.mjs');
    return finalizeBook({ book: need(book, '<book>'), strict: flags.strict, skipBrowser: flags['skip-browser'], allowSkipBrowser: flags['allow-skip-browser'] });
  },
};

function printHuman(result) {
  if (result.summary) {
    console.log(result.summary);
  } else {
    const { ok, command, ...rest } = result;
    console.log(`${ok ? 'OK' : 'FAILED'} ${command}`);
    for (const [key, value] of Object.entries(rest)) {
      if (key === 'diagnostics') continue;
      console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }
  for (const d of result.diagnostics || []) {
    const where = [d.file, d.pointer || (d.line ? `line ${d.line}` : '')].filter(Boolean).join(' ');
    console.log(`  ${d.severity.toUpperCase()} ${d.code} ${where}: ${d.message}${d.hint ? `\n      hint: ${d.hint}` : ''}`);
  }
}

async function main() {
  const [commandName, ...rest] = process.argv.slice(2);
  if (!commandName || commandName === '--help' || commandName === 'help') {
    console.log(USAGE);
    return 0;
  }
  let parsed;
  let json = rest.includes('--json');
  try {
    parsed = parseArgs(rest);
    json = Boolean(parsed.flags.json);
    const command = COMMANDS[commandName];
    if (!command) throw new RedocsError(`Unknown command '${commandName}'`, { code: 'ERR_REDOCS_USAGE' });
    const result = await command(parsed);
    if (json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    const usage = error.code === 'ERR_REDOCS_USAGE' || error.code === 'ERR_REDOCS_ARGS';
    const payload = { ok: false, command: commandName, error: error.message, code: error.code || 'ERR_REDOCS_INTERNAL', hint: error.hint, diagnostics: error.diagnostics || [] };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.error(`redocs ${commandName}: ${error.message}${error.hint ? `\n  hint: ${error.hint}` : ''}`);
      if (usage) console.error(`\n${USAGE}`);
      if (!(error instanceof RedocsError)) console.error(error.stack);
    }
    return usage ? 2 : 1;
  }
}

process.exitCode = await main();
