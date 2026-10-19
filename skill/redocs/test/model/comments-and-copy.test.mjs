// Comments-as-source (phương án B) and copy-for-AI: the review thread lives in the Git repo as
// comments/<page-id>.jsonl and renders into the static site; the copy button carries page path +
// source in inline blocks so it works over file://.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildBook } from '../../lib/command-build-book-site.mjs';
import { checkBook } from '../../lib/command-check-book.mjs';
import { addComment, listComments, resolveComment } from '../../lib/command-comment.mjs';
import { loadBook } from '../../lib/load-book-from-directory.mjs';
import { starterBook, tempDir, writeText } from '../helpers/make-temp-book.mjs';

const PAGE = 'overview/system-context';

function distPage(dir, milestone = 'v1', id = PAGE) {
  return readFileSync(path.join(dir, 'dist', milestone, `${id}.html`), 'utf8');
}

test('comment CLI: add, reply, resolve; loader and check see them', () => {
  const dir = starterBook();
  const a = addComment({ book: dir, page: PAGE, author: 'Mai', body: 'Is the cache write-through?' });
  assert.equal(a.comment, 'c-1');
  const b = addComment({ book: dir, page: PAGE, author: 'Khoa', body: 'Yes, write-through.', replyTo: 'c-1' });
  assert.equal(b.comment, 'c-2');
  resolveComment({ book: dir, page: PAGE, id: 'c-1' });

  const book = loadBook(dir);
  const thread = book.comments.get(PAGE);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].resolved, true);
  assert.equal(thread[1].reply_to, 'c-1');
  assert.equal(thread[1].author, 'Khoa');

  // Comments are valid data: no new check errors.
  assert.equal(checkBook({ book: dir }).diagnostics.filter((d) => d.code === 'RD013').length, 0);

  const listed = listComments({ book: dir, page: PAGE });
  assert.equal(listed.total, 2);
});

test('comment CLI: reply to a missing id and unknown page are rejected', () => {
  const dir = starterBook();
  assert.throws(() => addComment({ book: dir, page: PAGE, author: 'X', body: 'hi', replyTo: 'c-99' }), /reply to/);
  assert.throws(() => addComment({ book: dir, page: 'no/such', author: 'X', body: 'hi' }), /Unknown page/);
});

test('RD013: malformed line, unknown reply target, duplicate id, dangling anchor', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'comments', `${PAGE}.jsonl`), [
    JSON.stringify({ id: 'c-1', author: 'A', created: '2026-01-01T00:00:00Z', body: 'root' }),
    JSON.stringify({ id: 'c-1', author: 'B', created: '2026-01-01T00:00:00Z', body: 'dup id' }),
    JSON.stringify({ id: 'c-3', author: 'C', created: '2026-01-01T00:00:00Z', body: 'reply', reply_to: 'c-missing' }),
    JSON.stringify({ id: 'c-4', author: 'D', created: '2026-01-01T00:00:00Z', body: 'anchored', anchor: 'no-such-heading' }),
    '{ not json',
  ].join('\n') + '\n');
  const diags = checkBook({ book: dir }).diagnostics;
  const rd013 = diags.filter((d) => d.code === 'RD013');
  assert.ok(rd013.some((d) => /Duplicate comment id/.test(d.message)));
  assert.ok(rd013.some((d) => /replies to unknown comment/.test(d.message)));
  assert.ok(rd013.some((d) => d.severity === 'warning' && /anchored/.test(d.message)));
  assert.ok(rd013.some((d) => /Invalid comment JSON/.test(d.message)));
});

test('RD013: comments file for an unknown page is reported', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'comments/ghost/page.jsonl'), JSON.stringify({ id: 'c-1', author: 'A', created: 't', body: 'x' }) + '\n');
  assert.ok(checkBook({ book: dir }).diagnostics.some((d) => d.code === 'RD013' && /unknown page/.test(d.message)));
});

test('build: comments render into the page; replies nest; resolved is marked', () => {
  const dir = starterBook();
  addComment({ book: dir, page: PAGE, author: 'Mai', body: 'First comment here' });
  addComment({ book: dir, page: PAGE, author: 'Khoa', body: 'A reply', replyTo: 'c-1' });
  resolveComment({ book: dir, page: PAGE, id: 'c-1' });
  buildBook({ book: dir });
  const html = distPage(dir);
  assert.match(html, /rd-comments/);
  assert.match(html, /First comment here/);
  assert.match(html, /rd-comment__replies/);
  assert.match(html, /A reply/);
  assert.match(html, /is-resolved/);
  assert.match(html, /Mai/);
});

test('build: a page with no comments still shows an empty Comments section', () => {
  const dir = starterBook();
  buildBook({ book: dir });
  assert.match(distPage(dir), /No comments yet/);
});

test('copy-for-AI: toolbar, meta JSON and verbatim source are embedded in every content page', () => {
  const dir = starterBook();
  buildBook({ book: dir });
  const html = distPage(dir);
  assert.match(html, /data-rd-copy/);
  assert.match(html, /rd-copy-meta/);
  assert.match(html, /rd-copy-source/);
  assert.match(html, /data-rd-copy-action="ai-context"/);
  assert.match(html, /"pageRef":"page:overview\/system-context"/);
});

test('copy-for-AI: a </script> in the source cannot break out of the inline block', () => {
  const dir = starterBook();
  writeText(path.join(dir, 'pages', PAGE, 'index.md'), '# X\n\nText with </script> inside\n');
  buildBook({ book: dir });
  const html = distPage(dir);
  // Isolate the copy-source block and assert no raw </script> can close it early.
  const block = html.slice(html.indexOf('id="rd-copy-source"'), html.indexOf('<script src='));
  assert.ok(!/<\/script>/i.test(block.replace(/<\/script>\s*$/, '')), 'copy-source must not contain a premature </script>');
  assert.match(block, /&lt;\/script&gt;|<\\\/script/);
});
