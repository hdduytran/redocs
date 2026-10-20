// Semantic rules of `redocs check`. Each rule has a stable code documented in
// references/check-codes.md (a test keeps that document and this list in sync).
//
// RD000 unreadable/invalid JSON          RD007 artifact embed / receipt / freshness
// RD001 schema violation                 RD008 asset missing
// RD002 chapters vs pages                RD009 remote resource (not offline)
// RD003 page link or anchor broken       RD010 entity graph (depends_on, replaced_by, since/until)
// RD004 unknown entity                   RD011 open TODO(owner) question (warning)
// RD005 entity not alive at milestone    RD012 milestone / chapter declaration
// RD006 page variants and source files
// RD013 comment references a missing page, anchor or reply target
// RD014 book written with an older (warning) or newer (error) ReDocs than this skill
// RD015 published site (book.json publish.dir) is stale or missing vs the current sources (warning)

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { bookVersion, compareVersions, REDOCS_VERSION } from './redocs-version.mjs';
import { hashSources, publishDir, publishedSourceHash } from './publish-site.mjs';
import { renderedKey } from './render-book-pages.mjs';
import { diagnostic, sha256File } from './shared-helpers.mjs';

export const RULE_CODES = ['RD000', 'RD001', 'RD002', 'RD003', 'RD004', 'RD005', 'RD006', 'RD007', 'RD008', 'RD009', 'RD010', 'RD011', 'RD012', 'RD013', 'RD014', 'RD015'];

function ruleSkillVersion(book, out) {
  const version = bookVersion(book.config);
  const order = compareVersions(version, REDOCS_VERSION);
  if (order < 0) {
    out.push(diagnostic('RD014', 'warning', `Book format is ReDocs ${version}; this skill is ${REDOCS_VERSION}`, {
      file: 'book.json', pointer: '/redocsVersion', hint: 'Run `redocs upgrade <book>` to see what changed, then `redocs upgrade <book> --apply`.',
    }));
  } else if (order > 0) {
    out.push(diagnostic('RD014', 'error', `Book was written with ReDocs ${version}, newer than this skill (${REDOCS_VERSION})`, {
      file: 'book.json', pointer: '/redocsVersion', hint: 'Update the ReDocs skill.',
    }));
  }
}

/**
 * RD015: when book.json declares a committed publish folder, warn if it is missing or built from
 * sources that have since changed, so a new commit does not ship a published site nobody rebuilt.
 */
function rulePublishFreshness(book, out) {
  let rel;
  try {
    rel = publishDir(book.config);
  } catch (error) {
    out.push(diagnostic('RD015', 'error', error.message, { file: 'book.json', pointer: '/publish/dir', hint: error.hint }));
    return;
  }
  if (!rel) return;
  const dir = path.join(book.root, rel);
  if (!existsSync(dir) || !existsSync(path.join(dir, 'index.html'))) {
    out.push(diagnostic('RD015', 'warning', `Publish folder '${rel}/' is empty or missing`, { file: 'book.json', pointer: '/publish/dir', hint: 'Run `redocs finalize <book>` to build and publish it.' }));
    return;
  }
  const recorded = publishedSourceHash(book.root, rel);
  const current = hashSources(book.root, book.config);
  if (recorded !== current) {
    out.push(diagnostic('RD015', 'warning', `Published site '${rel}/' is stale: sources changed since it was built`, {
      file: 'book.json', pointer: '/publish/dir', hint: 'Run `redocs finalize <book>` to rebuild and republish it, then commit the folder.',
    }));
  }
}

function ruleMilestonesAndChapters(book, out) {
  const ids = book.milestones.map((m) => m.id);
  const current = book.milestones.filter((m) => m.status === 'current');
  if (current.length !== 1) {
    out.push(diagnostic('RD012', 'error', `Exactly one milestone must have status "current" (found ${current.length})`, { file: 'book.json', pointer: '/milestones', hint: 'Use `redocs promote <book> <milestone>` to move the current pointer.' }));
  }
  for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) out.push(diagnostic('RD012', 'error', `Duplicate milestone id '${id}'`, { file: 'book.json', pointer: '/milestones' }));
  const chapterIds = (book.config.chapters || []).map((c) => c.id);
  for (const id of chapterIds.filter((id, i) => chapterIds.indexOf(id) !== i)) out.push(diagnostic('RD012', 'error', `Duplicate chapter id '${id}'`, { file: 'book.json', pointer: '/chapters' }));
}

function ruleChapterPages(book, out) {
  const seen = new Map();
  (book.config.chapters || []).forEach((chapter, ci) => {
    (chapter.pages || []).forEach((id, pi) => {
      const pointer = `/chapters/${ci}/pages/${pi}`;
      if (!book.pages.has(id)) {
        out.push(diagnostic('RD002', 'error', `Chapter '${chapter.id}' lists unknown page '${id}'`, { file: 'book.json', pointer, hint: `Create it with: redocs add-page <book> ${id} --title "..." --kind <kind>` }));
      }
      if (seen.has(id)) out.push(diagnostic('RD002', 'error', `Page '${id}' is listed twice (also at ${seen.get(id)})`, { file: 'book.json', pointer }));
      else seen.set(id, pointer);
    });
  });
  for (const page of book.pages.values()) {
    if (!seen.has(page.id)) out.push(diagnostic('RD002', 'warning', `Page '${page.id}' is not in any chapter, so readers cannot navigate to it`, { file: page.metaFile, hint: 'Add it to a chapter in book.json.' }));
  }
}

function ruleVariants(book, out) {
  const known = new Set(book.milestones.map((m) => m.id));
  for (const page of book.pages.values()) {
    for (const [milestone, file] of Object.entries(page.variants || {})) {
      if (!known.has(milestone)) out.push(diagnostic('RD006', 'error', `Variant for unknown milestone '${milestone}'`, { file: page.metaFile, pointer: `/variants/${milestone}` }));
      if (!existsSync(path.join(page.dir, file))) out.push(diagnostic('RD006', 'error', `Variant file missing: ${file}`, { file: page.metaFile, pointer: `/variants/${milestone}` }));
    }
    // A source file the page never renders is almost always a mistake (e.g. index.md shadowing index.html).
    const used = new Set(page.variants ? Object.values(page.variants) : [page.entry]);
    for (const name of readdirSync(page.dir).sort()) {
      if (/\.(md|html)$/.test(name) && !used.has(name)) {
        out.push(diagnostic('RD006', 'warning', `Source file ${name} is not used by this page (renders ${[...used].join(', ')})`, {
          file: page.metaFile, hint: 'Delete it, or point "entry"/"variants" in page.json at it.',
        }));
      }
    }
  }
}

function ruleLinksAndAnchors(book, rendered, out) {
  for (const r of rendered.values()) {
    for (const link of r.ctx.links) {
      if (!book.pages.has(link.target)) {
        out.push(diagnostic('RD003', 'error', `Link to unknown page '${link.target}'`, { file: link.file, line: link.line }));
        continue;
      }
      if (!link.anchor) continue;
      const target = rendered.get(renderedKey(r.milestone, link.target));
      if (!target.headings.some((h) => h.id === link.anchor)) {
        // Name the milestone only when the answer can differ per milestone (variants involved),
        // so a shared page reports one problem instead of one per milestone.
        const perMilestone = r.page.variants || target.page.variants;
        out.push(diagnostic('RD003', 'error', `Anchor '#${link.anchor}' not found on page '${link.target}'${perMilestone ? ` at milestone '${r.milestone}'` : ''}`, {
          file: link.file, line: link.line, hint: `Available: ${target.headings.map((h) => h.id).slice(0, 8).join(', ') || '(no headings)'}`,
        }));
      }
    }
  }
}

function ruleArtifacts(book, rendered, out) {
  const embedded = new Set();
  for (const r of rendered.values()) for (const e of r.ctx.embeds) if (e.id) embedded.add(e.id);
  for (const artifact of book.artifacts.values()) {
    const file = artifact.receiptFile;
    if (!artifact.receipt) {
      out.push(diagnostic('RD007', 'error', `Artifact '${artifact.id}' has no receipt.json`, { file: `artifacts/${artifact.id}`, hint: `Render it with: redocs embed <book> <plugin> ${artifact.id} --spec <file>` }));
      continue;
    }
    const { receipt } = artifact;
    if (!receipt.ok) {
      out.push(diagnostic('RD007', 'error', `Last render of '${artifact.id}' failed: ${receipt.error || 'see pluginReceipt'}`, { file, hint: 'Fix the spec and run `redocs embed` again.' }));
    }
    if (!artifact.files.includes(receipt.output)) {
      out.push(diagnostic('RD007', 'error', `Artifact output missing: artifacts/${artifact.id}/${receipt.output}`, { file }));
    }
    const spec = artifact.files.find((f) => f.startsWith('spec.'));
    if (!spec) {
      out.push(diagnostic('RD007', 'error', `Artifact '${artifact.id}' has no spec.* file, so it cannot be re-rendered`, { file }));
    } else if (sha256File(path.join(artifact.dir, spec)) !== receipt.inputHash) {
      out.push(diagnostic('RD007', 'error', `Artifact '${artifact.id}' is stale: ${spec} changed after the last render`, { file: `artifacts/${artifact.id}/${spec}`, hint: 'Run `redocs embed <book> --refresh-stale`.' }));
    }
    if (!embedded.has(artifact.id)) {
      out.push(diagnostic('RD007', 'warning', `Artifact '${artifact.id}' is not embedded on any page`, { file }));
    }
  }
}

function ruleEntityGraph(book, out) {
  const order = new Map(book.milestones.map((m, i) => [m.id, i]));
  for (const entity of book.entities.values()) {
    const at = (field) => ({ file: entity._file, pointer: `${entity._pointer}/${field}` });
    for (const dep of entity.depends_on || []) {
      if (!book.entities.has(dep)) out.push(diagnostic('RD010', 'error', `'${entity.id}' depends on unknown entity '${dep}'`, at('depends_on')));
    }
    if (entity.replaced_by && !book.entities.has(entity.replaced_by)) {
      out.push(diagnostic('RD010', 'error', `'${entity.id}' is replaced by unknown entity '${entity.replaced_by}'`, at('replaced_by')));
    }
    if (entity.replaced_by && !entity.until) {
      out.push(diagnostic('RD010', 'error', `'${entity.id}' has replaced_by but no "until" milestone`, { ...at('until'), hint: 'Set "until" to the first milestone where the replacement is live.' }));
    }
    for (const field of ['since', 'until']) {
      if (entity[field] && !order.has(entity[field])) out.push(diagnostic('RD010', 'error', `'${entity.id}' ${field}: unknown milestone '${entity[field]}'`, at(field)));
    }
    if (entity.since && entity.until && order.get(entity.since) >= order.get(entity.until)) {
      out.push(diagnostic('RD010', 'error', `'${entity.id}' since (${entity.since}) must come before until (${entity.until})`, at('until')));
    }
  }
}

/**
 * RD013: comment threads must target a real page, a heading that exists on it, and a reply
 * target in the same thread. Comments are page-scoped (not per milestone); anchors are checked
 * against the current milestone's rendering of that page.
 */
function ruleComments(book, rendered, out) {
  const currentId = (book.milestones.find((m) => m.status === 'current') || book.milestones[0])?.id;
  for (const [pageId, list] of book.comments) {
    const file = `comments/${pageId}.jsonl`;
    if (!book.pages.has(pageId)) {
      out.push(diagnostic('RD013', 'error', `Comments file targets unknown page '${pageId}'`, { file, hint: 'Rename the file to comments/<existing-page-id>.jsonl, or remove it.' }));
      continue;
    }
    const ids = new Set(list.map((c) => c.id));
    const dupes = new Set();
    const seen = new Set();
    const target = currentId ? rendered.get(renderedKey(currentId, pageId)) : null;
    const headingIds = new Set((target?.headings || []).map((h) => h.id));
    for (const c of list) {
      if (seen.has(c.id)) dupes.add(c.id);
      seen.add(c.id);
      if (c.anchor && target && !headingIds.has(c.anchor)) {
        out.push(diagnostic('RD013', 'warning', `Comment '${c.id}' is anchored to '#${c.anchor}', which no heading on '${pageId}' matches`, { file, line: c._line, hint: `Headings: ${[...headingIds].slice(0, 8).join(', ') || '(none)'}` }));
      }
      if (c.reply_to && !ids.has(c.reply_to)) {
        out.push(diagnostic('RD013', 'error', `Comment '${c.id}' replies to unknown comment '${c.reply_to}'`, { file, line: c._line }));
      }
    }
    for (const id of dupes) out.push(diagnostic('RD013', 'error', `Duplicate comment id '${id}' in ${file}`, { file }));
  }
}

/**
 * Run every rule. `rendered` + `renderDiagnostics` come from renderBookPages (RD003-RD009, RD011).
 * @returns {import('./shared-helpers.mjs').Diagnostic[]}
 */
export function runCheckRules(book, rendered, renderDiagnostics) {
  const out = [...book.diagnostics];
  if (!book.config) return out;
  ruleSkillVersion(book, out);
  rulePublishFreshness(book, out);
  ruleMilestonesAndChapters(book, out);
  ruleChapterPages(book, out);
  ruleVariants(book, out);
  ruleEntityGraph(book, out);
  ruleLinksAndAnchors(book, rendered, out);
  ruleArtifacts(book, rendered, out);
  ruleComments(book, rendered, out);
  out.push(...renderDiagnostics);
  // Same problem reported at several milestones -> once.
  const seen = new Set();
  return out.filter((d) => {
    const key = `${d.code}|${d.severity}|${d.file}|${d.line}|${d.pointer}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || String(a.file).localeCompare(String(b.file)) || (a.line || 0) - (b.line || 0));
}
