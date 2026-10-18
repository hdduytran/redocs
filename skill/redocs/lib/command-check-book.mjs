// `redocs check <book> [--strict]`: validate the book without writing anything.

import { loadBook } from './load-book-from-directory.mjs';
import { renderBookPages } from './render-book-pages.mjs';
import { runCheckRules } from './check-book-rules.mjs';

/** @returns {{ok: boolean, command: 'check', errors: number, warnings: number, diagnostics: object[], book: object, rendered: object}} */
export function checkBookModel(bookDir, { strict = false } = {}) {
  const book = loadBook(bookDir);
  const render = book.config ? renderBookPages(book) : { pages: new Map(), diagnostics: [] };
  const diagnostics = runCheckRules(book, render.pages, render.diagnostics);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return { ok: errors === 0 && (!strict || warnings === 0), errors, warnings, diagnostics, book, render };
}

export function checkBook({ book: bookDir, strict = false }) {
  const { ok, errors, warnings, diagnostics, book } = checkBookModel(bookDir, { strict });
  return {
    ok,
    command: 'check',
    summary: `${ok ? 'OK' : 'FAILED'} check: ${errors} error(s), ${warnings} warning(s)${strict ? ' [strict]' : ''} in ${book.root}`,
    errors,
    warnings,
    diagnostics,
  };
}
