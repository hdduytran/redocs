// Pages ReDocs writes itself from the book model, so nobody has to keep them in sync by hand:
// milestone home, entity catalog, "changes A -> B" and side-by-side variant comparison.

import { comparisonPairs, isAlive, milestoneOrder, resolveVariant } from './milestone-order-and-lifecycle.mjs';
import { renderedKey } from './render-book-pages.mjs';
import { renderShell } from './render-page-shell-layout.mjs';
import { escapeHtml } from './shared-helpers.mjs';
import { entityAnchor, relativeHref, SITE } from './site-paths-and-urls.mjs';

const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function sameAt(book, milestone) {
  return Object.fromEntries(book.milestones.map((m) => [m.id, milestone(m.id)]));
}

export function buildHomePage(book, milestone) {
  const outFile = SITE.homeOut(milestone);
  const m = book.milestones.find((x) => x.id === milestone);
  const chapters = (book.config.chapters || []).map((chapter) => `<section class="rd-home__chapter"><h2>${escapeHtml(chapter.title)}</h2><ul>${chapter.pages
    .filter((id) => book.pages.has(id))
    .map((id) => {
      const page = book.pages.get(id);
      const summary = page.meta.summary ? ` — <span class="rd-muted">${escapeHtml(page.meta.summary)}</span>` : '';
      return `<li><a href="${relativeHref(outFile, SITE.pageOut(milestone, id))}">${escapeHtml(page.meta.title)}</a>${summary}</li>`;
    }).join('')}</ul></section>`).join('\n');
  const milestones = `<table class="rd-milestone-table"><thead><tr><th scope="col">Milestone</th><th scope="col">Status</th><th scope="col">Description</th></tr></thead><tbody>${book.milestones
    .map((x) => `<tr${x.id === milestone ? ' class="is-active"' : ''}><td><a href="${relativeHref(outFile, SITE.homeOut(x.id))}">${escapeHtml(x.label)}</a></td><td>${escapeHtml(x.status)}${x.date ? ` · ${escapeHtml(x.date)}` : ''}</td><td>${escapeHtml(x.description || '')}</td></tr>`).join('')}</tbody></table>`;
  const body = `<h1>${escapeHtml(book.config.title)}</h1>
${book.config.subtitle ? `<p class="rd-lead">${escapeHtml(book.config.subtitle)}</p>` : ''}
${book.config.description ? `<p>${escapeHtml(book.config.description)}</p>` : ''}
<p>You are reading the book at milestone <strong>${escapeHtml(m.label)}</strong> (${escapeHtml(m.status)}). Use the milestone bar to see the system at another stage.</p>
<h2 id="milestones">Milestones</h2>
${milestones}
${chapters}`;
  return { outFile, html: renderShell({ book, milestone, outFile, title: 'Home', bodyHtml: body, headings: [], switchTargets: sameAt(book, SITE.homeOut) }) };
}

function entityRow(book, entity, outFile, milestone, order) {
  const deps = (entity.depends_on || []).map((id) => {
    const dep = book.entities.get(id);
    return dep ? `<a href="${relativeHref(outFile, SITE.catalogTypeOut(milestone, dep.type), entityAnchor(id))}">${escapeHtml(dep.name)}</a>` : escapeHtml(id);
  }).join(', ');
  const lifecycle = [entity.since ? `since ${entity.since}` : null, entity.until ? `until ${entity.until}` : null, entity.replaced_by ? `replaced by ${entity.replaced_by}` : null].filter(Boolean).join(' · ');
  const alive = isAlive(entity, milestone, order);
  return `<section class="rd-entity-card${alive ? '' : ' is-inactive'}" id="${escapeHtml(entityAnchor(entity.id))}">
<h2>${escapeHtml(entity.name)} <code>${escapeHtml(entity.id)}</code></h2>
${entity.summary ? `<p>${escapeHtml(entity.summary)}</p>` : ''}
<dl>
${entity.owner ? `<dt>Owner</dt><dd>${escapeHtml(entity.owner)}</dd>` : ''}
${entity.tech?.length ? `<dt>Tech</dt><dd>${entity.tech.map(escapeHtml).join(', ')}</dd>` : ''}
${deps ? `<dt>Depends on</dt><dd>${deps}</dd>` : ''}
${lifecycle ? `<dt>Lifecycle</dt><dd>${escapeHtml(lifecycle)}</dd>` : ''}
${entity.links?.length ? `<dt>Links</dt><dd>${entity.links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(', ')}</dd>` : ''}
</dl>
</section>`;
}

/** Catalog pages list entities alive at the milestone; entities not alive are listed separately so links still resolve. */
export function buildCatalogPages(book, milestone) {
  const order = milestoneOrder(book.milestones);
  const all = [...book.entities.values()];
  const types = [...new Set(all.map((e) => e.type))].sort();
  const out = [];
  const indexFile = SITE.catalogIndexOut(milestone);
  const counts = types.map((type) => {
    const ofType = all.filter((e) => e.type === type);
    return `<tr><td><a href="${relativeHref(indexFile, SITE.catalogTypeOut(milestone, type))}">${escapeHtml(type)}</a></td><td>${ofType.filter((e) => isAlive(e, milestone, order)).length}</td><td>${ofType.length}</td></tr>`;
  }).join('');
  const indexBody = `<h1>Catalog</h1><p>Every entity registered in <code>entities/</code>, at milestone <strong>${escapeHtml(milestone)}</strong>.</p>
${types.length ? `<table><thead><tr><th scope="col">Type</th><th scope="col">Alive at ${escapeHtml(milestone)}</th><th scope="col">Total</th></tr></thead><tbody>${counts}</tbody></table>` : '<p>No entities yet.</p>'}`;
  out.push({ outFile: indexFile, html: renderShell({ book, milestone, outFile: indexFile, title: 'Catalog', bodyHtml: indexBody, switchTargets: sameAt(book, SITE.catalogIndexOut) }) });

  for (const type of types) {
    const outFile = SITE.catalogTypeOut(milestone, type);
    const ofType = all.filter((e) => e.type === type).sort(byName);
    const alive = ofType.filter((e) => isAlive(e, milestone, order));
    const inactive = ofType.filter((e) => !isAlive(e, milestone, order));
    const body = `<h1>${escapeHtml(type)}</h1>
${alive.map((e) => entityRow(book, e, outFile, milestone, order)).join('\n') || '<p>None at this milestone.</p>'}
${inactive.length ? `<h2 id="not-at-this-milestone">Not at this milestone</h2>${inactive.map((e) => entityRow(book, e, outFile, milestone, order)).join('\n')}` : ''}`;
    const headings = ofType.map((e) => ({ level: 2, text: e.name, id: entityAnchor(e.id) }));
    out.push({ outFile, html: renderShell({ book, milestone, outFile, title: type, bodyHtml: body, headings, switchTargets: sameAt(book, (m) => SITE.catalogTypeOut(m, type)) }) });
  }
  return out;
}

/** Data behind a "changes from -> to" page; exported for tests. */
export function diffMilestones(book, from, to) {
  const order = milestoneOrder(book.milestones);
  const all = [...book.entities.values()].sort(byName);
  const before = all.filter((e) => isAlive(e, from, order));
  const after = all.filter((e) => isAlive(e, to, order));
  const added = after.filter((e) => !before.includes(e));
  const gone = before.filter((e) => !after.includes(e));
  const replaced = gone.filter((e) => e.replaced_by);
  const removed = gone.filter((e) => !e.replaced_by);
  const changedPages = [...book.pages.values()].filter((page) => {
    if (!page.variants) return false;
    return resolveVariant(page, from, book.milestones)?.file !== resolveVariant(page, to, book.milestones)?.file;
  }).map((page) => page.id).sort();
  return { added, removed, replaced, changedPages };
}

export function buildChangesPages(book, milestone) {
  return comparisonPairs(book.milestones).filter(([, to]) => to === milestone).map(([from]) => {
    const outFile = SITE.changesOut(milestone, from);
    const d = diffMilestones(book, from, milestone);
    const entityLink = (e, m) => `<a href="${relativeHref(outFile, SITE.catalogTypeOut(m, e.type), entityAnchor(e.id))}">${escapeHtml(e.name)}</a> <code>${escapeHtml(e.id)}</code>`;
    const list = (items, render) => (items.length ? `<ul>${items.map((x) => `<li>${render(x)}</li>`).join('')}</ul>` : '<p class="rd-muted">None.</p>');
    const body = `<h1>Changes ${escapeHtml(from)} → ${escapeHtml(milestone)}</h1>
<p>Generated from <code>entities/</code> lifecycles and page variants.</p>
<h2 id="added">Added</h2>${list(d.added, (e) => entityLink(e, milestone))}
<h2 id="replaced">Replaced</h2>${list(d.replaced, (e) => {
      const by = book.entities.get(e.replaced_by);
      return `${entityLink(e, from)} → ${by ? entityLink(by, milestone) : escapeHtml(e.replaced_by)}`;
    })}
<h2 id="removed">Removed</h2>${list(d.removed, (e) => entityLink(e, from))}
<h2 id="pages-with-new-content">Pages with new content</h2>${list(d.changedPages, (id) => {
      const page = book.pages.get(id);
      return `<a href="${relativeHref(outFile, SITE.pageOut(milestone, id))}">${escapeHtml(page.meta.title)}</a> · <a href="${relativeHref(outFile, SITE.compareOut(milestone, id, from))}">compare ${escapeHtml(from)} ↔ ${escapeHtml(milestone)}</a>`;
    })}`;
    const headings = [{ level: 2, text: 'Added', id: 'added' }, { level: 2, text: 'Replaced', id: 'replaced' }, { level: 2, text: 'Removed', id: 'removed' }, { level: 2, text: 'Pages with new content', id: 'pages-with-new-content' }];
    return { outFile, html: renderShell({ book, milestone, outFile, title: `Changes ${from} → ${milestone}`, bodyHtml: body, headings }) };
  });
}

/** Side-by-side pages for variant pages whose body differs between a comparison pair ending at `milestone`. */
export function buildComparePages(book, milestone, rendered) {
  const out = [];
  for (const [from] of comparisonPairs(book.milestones).filter(([, to]) => to === milestone)) {
    for (const id of diffMilestones(book, from, milestone).changedPages) {
      const outFile = SITE.compareOut(milestone, id, from);
      const left = rendered.get(renderedKey(from, id));
      const right = rendered.get(renderedKey(milestone, id));
      // Each column iframes the real page (?embed=1 hides the chrome), so relative URLs inside
      // the bodies keep working without re-basing.
      const frame = (m, r) => `<section class="rd-compare__col" aria-label="${escapeHtml(m)}"><h2>${escapeHtml(m)}${r?.resolved?.inheritedFrom ? ` <span class="rd-badge">inherited from ${escapeHtml(r.resolved.inheritedFrom)}</span>` : ''}</h2><iframe class="rd-compare__frame" src="${relativeHref(outFile, SITE.pageOut(m, id))}?embed=1" title="${escapeHtml(book.pages.get(id).meta.title)} at ${escapeHtml(m)}" height="1200"></iframe></section>`;
      const body = `<h1>${escapeHtml(book.pages.get(id).meta.title)}: ${escapeHtml(from)} ↔ ${escapeHtml(milestone)}</h1>
<div class="rd-compare">${frame(from, left)}${frame(milestone, right)}</div>`;
      out.push({ outFile, html: renderShell({ book, milestone, outFile, title: `Compare ${from} ↔ ${milestone}`, bodyHtml: body, wide: true }) });
    }
  }
  return out;
}
