// Agent index + query engine (vectorless retrieval): map -> search/outline -> read, entity graph,
// milestone change sets, citations. Same engine the CLI, MCP server and in-book chat use.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAgentIndex, buildAgentIndexes, htmlToReadableText } from '../../lib/build-agent-index.mjs';
import { loadBook } from '../../lib/load-book-from-directory.mjs';
import { agentIndexFor, dispatch, RedocsQuery, TOOL_SPECS } from '../../lib/query-book-index.mjs';
import { renderBookPages } from '../../lib/render-book-pages.mjs';
import { richBook, writeText } from '../helpers/make-temp-book.mjs';
import path from 'node:path';

const dir = await richBook();
const v1 = agentIndexFor(dir, 'v1');
const v2 = agentIndexFor(dir, 'v2');

test('index: pages in chapter order, sections cut at h1-h3, entities and links per page', () => {
  assert.deepEqual(v1.pages.slice(0, 3).map((p) => p.id), ['vision/why', 'overview/system-context', 'services/overview']);
  const services = v1.pages.find((p) => p.id === 'services/overview');
  assert.deepEqual(services.sections.map((s) => [s.anchor, s.level]), [['services', 1], ['billing', 2], ['retry-policy', 3], ['gateway', 2]]);
  assert.match(services.sections[2].text, /#### Notes/, 'h4 stays inside its h3 section');
  assert.ok(services.anchors.includes('notes'), 'every heading id is a valid citation anchor');
  assert.deepEqual(services.entities, ['svc:billing', 'svc:gateway']);
  assert.deepEqual(services.links, ['network/topology']);
});

test('index: summary from page.json, else the first real paragraph', () => {
  const why = v1.pages.find((p) => p.id === 'vision/why');
  assert.equal(why.summary, 'Vì sao hệ thống tồn tại');
  assert.equal(why.summarySource, 'page.json');
  const services = v1.pages.find((p) => p.id === 'services/overview');
  assert.equal(services.summary, 'Tổng quan các dịch vụ của hệ thống và ranh giới giữa chúng.');
  assert.equal(services.summarySource, 'auto');
});

test('index: milestone-aware pages and entities', () => {
  const split = (index) => index.pages.find((p) => p.id === 'proposals/split-billing');
  assert.equal(split(v1).exists, false);
  assert.equal(split(v1).startsAt, 'v2');
  assert.equal(split(v2).exists, true);
  assert.equal(v1.entities.find((e) => e.id === 'svc:billing').alive, false);
  assert.equal(v2.entities.find((e) => e.id === 'svc:billing').alive, true);
  assert.match(v2.pages.find((p) => p.id === 'network/topology').sections[0].text, /Topology v2/);
});

test('index is deterministic', () => {
  const book = loadBook(dir);
  const { pages } = renderBookPages(book);
  const a = JSON.stringify([...buildAgentIndexes(book, pages)]);
  const b = JSON.stringify([...buildAgentIndexes(book, pages)]);
  assert.equal(a, b);
  assert.equal(JSON.stringify(buildAgentIndex(book, pages, 'v1')), JSON.stringify(v1));
});

test('htmlToReadableText keeps lines, list items and table cells', () => {
  const text = htmlToReadableText('<h2 id="a">A &amp; B</h2><p>One<br>two</p><ul><li>x</li><li>y</li></ul><table><tr><th>k</th><td>v</td></tr></table><script>bad()</script>');
  assert.match(text, /A & B/);
  assert.match(text, /One\ntwo/);
  assert.match(text, /- x\n- y/);
  assert.match(text, /k \| v \|/);
  assert.doesNotMatch(text, /bad/);
});

test('search: accent-insensitive BM25 over sections, refs carry anchors', () => {
  const r = RedocsQuery.search(v1, 'co so du lieu');
  assert.equal(r.ok, true);
  assert.equal(r.results[0].ref, 'page:services/overview#billing');
  assert.match(r.results[0].snippet, /cơ sở dữ liệu/, 'snippet shows the original text');
  const retry = RedocsQuery.search(v1, 'thử lại backoff');
  assert.equal(retry.results[0].ref, 'page:services/overview#retry-policy');
  assert.ok(RedocsQuery.search(v1, 'postgre').results.some((x) => x.ref === 'page:services/overview#billing'), 'prefix match');
  assert.ok(RedocsQuery.search(v1, 'Billing').results.some((x) => x.ref === 'entity:svc:billing'), 'entities are searchable');
  assert.equal(RedocsQuery.search(v1, 'billing', { kind: 'proposal' }).results.length, 0, 'split-billing does not exist at v1');
  assert.equal(RedocsQuery.search(v2, 'billing', { kind: 'proposal' }).results[0].page, 'proposals/split-billing');
  assert.equal(RedocsQuery.search(v1, '   ').ok, false);
  assert.ok(RedocsQuery.search(v1, 'zzqx').hint);
});

test('read: a section includes its subsections, paging, and helpful errors', () => {
  const billing = RedocsQuery.read(v1, 'page:services/overview#billing');
  assert.equal(billing.ok, true);
  assert.match(billing.text, /Retry policy/);
  assert.doesNotMatch(billing.text, /Gateway/);
  const page = RedocsQuery.read(v1, 'services/overview', { maxChars: 200 });
  assert.equal(page.truncated, true);
  const rest = RedocsQuery.read(v1, 'services/overview', { maxChars: 40000, offset: page.nextOffset });
  assert.equal(page.text + rest.text, RedocsQuery.read(v1, 'services/overview', { maxChars: 40000 }).text);
  assert.match(RedocsQuery.read(v1, 'page:services/overview#nope').hint, /billing/);
  assert.match(RedocsQuery.read(v1, 'page:services/overview#notes').error, /minor heading/);
  assert.match(RedocsQuery.read(v1, 'page:servics/overview').hint, /services\/overview/);
  assert.match(RedocsQuery.read(v1, 'proposals/split-billing').hint, /v2/);
});

test('outline lists sections with refs and sizes', () => {
  const o = RedocsQuery.outline(v1, 'page:services/overview');
  assert.equal(o.chapter, 'services');
  assert.deepEqual(o.sections.map((s) => s.ref), ['page:services/overview#services', 'page:services/overview#billing', 'page:services/overview#retry-policy', 'page:services/overview#gateway']);
  assert.ok(o.sections.every((s) => s.chars > 0));
});

test('entity: lifecycle, dependents, replacements and pages that mention it', () => {
  const monolith = RedocsQuery.entity(v1, 'svc:monolith');
  assert.deepEqual(monolith.dependents, ['svc:gateway']);
  assert.equal(monolith.entity.replaced_by, 'svc:billing');
  const billing = RedocsQuery.entity(v2, 'entity:svc:billing');
  assert.equal(billing.alive, true);
  assert.deepEqual(billing.replaces, ['svc:monolith']);
  assert.deepEqual(billing.pages.map((p) => p.ref).sort(), ['page:network/topology', 'page:services/overview']);
  assert.match(RedocsQuery.entity(v1, 'svc:biling').hint, /svc:billing/);
});

test('changes: default is the change sets ending at the index milestone', () => {
  const r = RedocsQuery.changes(v2);
  assert.deepEqual(r.changes.map((c) => `${c.from}->${c.to}`), ['v1->v2']);
  assert.deepEqual(r.changes[0].added, ['svc:billing']);
  assert.deepEqual(r.changes[0].replaced, [{ id: 'svc:monolith', by: 'svc:billing' }]);
  assert.ok(r.changes[0].changedPages.includes('network/topology'));
  assert.equal(RedocsQuery.changes(v1, { from: 'v1', to: 'target' }).ok, true);
  assert.equal(RedocsQuery.changes(v1).ok, false, 'nothing ends at the first milestone');
});

test('citations: valid and invalid page refs in an answer', () => {
  const r = RedocsQuery.citations(v1, 'Billing (page:services/overview#billing) and page:services/overview#nope and page:ghost/page.');
  assert.deepEqual(r.citations.map((c) => [c.ref, c.valid]), [['page:services/overview#billing', true], ['page:services/overview#nope', false], ['page:ghost/page', false]]);
  assert.equal(r.invalid, 2);
});

test('map: chapters with page cards; large books collapse to chapters', () => {
  const m = RedocsQuery.map(v1);
  assert.equal(m.chapters[0].pages[0].summary, 'Vì sao hệ thống tồn tại');
  assert.equal(m.entityTypes.service.total, 3);
  assert.equal(RedocsQuery.map(v1, { chapter: 'services' }).chapters.length, 1);
  assert.equal(RedocsQuery.map(v1, { chapter: 'nope' }).ok, false);
  const big = { ...v1, pages: Array.from({ length: 151 }, (_, i) => ({ ...v1.pages[0], id: `p/${i}` })), chapters: [{ id: 'all', title: 'All', pages: Array.from({ length: 151 }, (_, i) => `p/${i}`) }] };
  const collapsed = RedocsQuery.map(big);
  assert.equal(collapsed.truncated, true);
  assert.equal(collapsed.chapters[0].pages, undefined);
  assert.match(RedocsQuery.mapText(big, { limit: 2000 }), /call book_map with/);
  assert.match(RedocsQuery.mapText(v1), /page:services\/overview · Services \[service\]/);
});

test('dispatch: every tool spec is callable; unknown tools and bad input fail softly', () => {
  assert.deepEqual(TOOL_SPECS.map((t) => t.name), ['book_map', 'book_outline', 'book_search', 'book_read', 'book_entity', 'book_changes', 'book_citations']);
  assert.equal(dispatch(v1, 'book_map', {}).ok, true);
  assert.equal(dispatch(v1, 'book_search', { query: 'gateway', k: '2' }).results.length <= 2, true);
  assert.equal(dispatch(v1, 'book_nope', {}).ok, false);
  assert.equal(dispatch(v1, 'book_outline', {}).ok, false);
});

test('agentIndexFor reloads after a source edit and rejects unknown milestones', () => {
  writeText(path.join(dir, 'pages/flows/overview/index.md'), '# Key flows\n\n## Checkout\n\nLuồng checkout gọi billing.\n');
  const fresh = agentIndexFor(dir, 'v1');
  assert.ok(RedocsQuery.search(fresh, 'checkout').results.some((r) => r.ref === 'page:flows/overview#checkout'));
  assert.throws(() => agentIndexFor(dir, 'v9'), { code: 'ERR_REDOCS_ARGS' });
});
