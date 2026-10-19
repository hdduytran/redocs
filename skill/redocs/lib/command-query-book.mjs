// `redocs query <book> <tool> ...`: the agent query tools from the terminal (approach D without
// MCP). Same engine and results as `redocs mcp` and the in-book chat; --json prints them raw.

import { agentIndexFor, dispatch } from './query-book-index.mjs';
import { RedocsError } from './shared-helpers.mjs';

const TOOLS = {
  map: { tool: 'book_map', input: (rest, f) => ({ chapter: f.chapter }) },
  outline: { tool: 'book_outline', input: (rest) => ({ page: need(rest[0], '<page-id>') }) },
  search: { tool: 'book_search', input: (rest, f) => ({ query: need(rest.join(' '), '<words>'), k: f.k, kind: f.kind, chapter: f.chapter }) },
  read: { tool: 'book_read', input: (rest, f) => ({ ref: need(rest[0], '<page:id#anchor>'), maxChars: f['max-chars'], offset: f.offset }) },
  entity: { tool: 'book_entity', input: (rest) => ({ id: need(rest[0], '<entity-id>') }) },
  changes: { tool: 'book_changes', input: (rest, f) => ({ from: f.from, to: f.to }) },
  citations: { tool: 'book_citations', input: (rest) => ({ text: need(rest.join(' '), '<text>') }) },
};

function need(value, label) {
  if (!value) throw new RedocsError(`Missing ${label}`, { code: 'ERR_REDOCS_USAGE' });
  return value;
}

function human(tool, r) {
  if (!r.ok) return `FAILED query ${tool}: ${r.error}${r.hint ? `\n  hint: ${r.hint}` : ''}`;
  switch (tool) {
    case 'book_map': {
      const card = (p) => `- page:${p.id} · ${p.title} [${p.kind}${p.exists === false ? ', not at this milestone' : ''}]${p.summary ? ` · ${p.summary}` : ''}${p.openQuestions ? ` · ${p.openQuestions} open question(s)` : ''}`;
      const lines = [`Book: ${r.book.title} (${r.book.id}) · milestone ${r.milestone.label} [${r.milestone.status}] · milestones: ${r.milestones.map((m) => m.id).join(', ')}`];
      for (const c of r.chapters) lines.push('', `## ${c.title} (${c.id}) · ${c.pageCount} page(s)`, ...(c.pages || []).map(card));
      if (r.unlisted) lines.push('', '## (in no chapter)', ...r.unlisted.map(card));
      const types = Object.keys(r.entityTypes).sort();
      if (types.length) lines.push('', `Entities (alive/total): ${types.map((t) => `${t} ${r.entityTypes[t].alive}/${r.entityTypes[t].total}`).join(', ')}`);
      if (r.hint) lines.push('', `hint: ${r.hint.replace('call book_map with {"chapter": "<id>"}', 'pass --chapter <id>')}`);
      return lines.join('\n');
    }
    case 'book_outline':
      return [`${r.ref} · ${r.title} [${r.kind}]${r.exists ? '' : ' (not at this milestone)'}`, r.summary ? `  ${r.summary}` : null,
        ...r.sections.map((s) => `${'  '.repeat(s.level)}${s.ref}  ${s.title}  (${s.chars} chars)`),
        r.entities.length ? `  entities: ${r.entities.join(', ')}` : null, r.links.length ? `  links: ${r.links.join(', ')}` : null].filter(Boolean).join('\n');
    case 'book_search':
      return [`${r.results.length} of ${r.total} match(es) for "${r.query}" at ${r.milestone}`,
        ...r.results.map((x) => `- ${x.ref}  ${x.title}${x.section ? ` › ${x.section}` : ''}  (${x.score})\n    ${x.snippet}`), r.hint ? `  hint: ${r.hint}` : null].filter(Boolean).join('\n');
    case 'book_read':
      return `${r.ref} · ${r.title}${r.section ? ` › ${r.section}` : ''} @ ${r.milestone}\n\n${r.text}${r.truncated ? `\n\n… truncated: ${r.totalChars} chars; continue with --offset ${r.nextOffset}` : ''}`;
    case 'book_entity': {
      const e = r.entity;
      return [`${e.id} · ${e.name} [${e.type}] ${r.alive ? 'alive' : 'NOT alive'} at ${r.milestone}`, e.summary ? `  ${e.summary}` : null,
        e.depends_on ? `  depends on: ${e.depends_on.join(', ')}` : null, r.dependents.length ? `  used by: ${r.dependents.join(', ')}` : null,
        [e.since && `since ${e.since}`, e.until && `until ${e.until}`, e.replaced_by && `replaced by ${e.replaced_by}`].filter(Boolean).join(' · ') || null,
        r.pages.length ? `  pages: ${r.pages.map((p) => p.ref).join(', ')}` : '  pages: (none mention it)'].filter(Boolean).join('\n');
    }
    case 'book_changes':
      return r.changes.map((c) => [`${c.from} -> ${c.to}`, `  added: ${c.added.join(', ') || '-'}`, `  replaced: ${c.replaced.map((x) => `${x.id} -> ${x.by}`).join(', ') || '-'}`,
        `  removed: ${c.removed.join(', ') || '-'}`, `  pages with new content: ${c.changedPages.join(', ') || '-'}`].join('\n')).join('\n');
    case 'book_citations':
      return r.citations.length ? r.citations.map((c) => `${c.valid ? 'OK     ' : 'MISSING'} ${c.ref}`).join('\n') : 'No page: references found.';
    default:
      return JSON.stringify(r, null, 2);
  }
}

export function queryBook({ book, tool: name, rest = [], flags = {} }) {
  const spec = TOOLS[need(name, `<tool> (${Object.keys(TOOLS).join('|')})`)];
  if (!spec) throw new RedocsError(`Unknown query tool '${name}'`, { code: 'ERR_REDOCS_USAGE', hint: `Tools: ${Object.keys(TOOLS).join(', ')}` });
  const index = agentIndexFor(book, flags.milestone);
  const result = dispatch(index, spec.tool, spec.input(rest, flags));
  return { ...result, ok: result.ok, command: 'query', tool: spec.tool, milestone: index.milestone.id, summary: human(spec.tool, result) };
}
