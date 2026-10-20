// `redocs pack <book> [--out file.zip]`: zip dist/ so the book can be sent and opened by
// double-clicking index.html after unzipping. Entries are sorted with a fixed mtime so the
// same dist/ always gives the same zip.

import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { loadBook } from './load-book-from-directory.mjs';
import { publishDir } from './publish-site.mjs';
import { RedocsError, toPosix } from './shared-helpers.mjs';

const FIXED_MTIME = new Date('2000-01-01T00:00:00Z');

function listFiles(dir) {
  const out = [];
  (function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  })(dir);
  return out;
}

export async function packBook({ book: bookDir, out }) {
  const book = loadBook(bookDir);
  // Prefer the committed publish copy when the book has one; fall back to dist/. Both are a built
  // site rooted at index.html, so the zip is identical in shape either way.
  const publishRel = publishDir(book.config);
  const source = publishRel && existsSync(path.join(book.root, publishRel, 'index.html'))
    ? path.join(book.root, publishRel)
    : path.join(book.root, 'dist');
  if (!existsSync(path.join(source, 'index.html'))) {
    throw new RedocsError(`${toPosix(path.relative(book.root, source))}/ is missing; build first`, { code: 'ERR_REDOCS_NO_DIST', hint: 'Run `redocs finalize <book>` (or `redocs build`).' });
  }
  const target = path.resolve(out || path.join(book.root, `${book.config.id}-book.zip`));
  if (target.startsWith(source + path.sep)) throw new RedocsError('The zip cannot be written inside the folder being packed', { code: 'ERR_REDOCS_PATH' });
  const folder = `${book.config.id}-book`;
  const zip = new yazl.ZipFile();
  const files = listFiles(source);
  for (const file of files) {
    zip.addBuffer(readFileSync(file), `${folder}/${toPosix(path.relative(source, file))}`, { mtime: FIXED_MTIME, mode: 0o100644 });
  }
  zip.end();
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(target)).on('close', resolve).on('error', reject);
  });
  return {
    ok: true,
    command: 'pack',
    summary: `OK pack: ${files.length} files -> ${target}\n  Readers unzip it and open ${folder}/index.html.`,
    zip: target,
    files: files.length,
    bytes: statSync(target).size,
  };
}
