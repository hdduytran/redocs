// `redocs init <dir> --name <id>`: scaffold a new book repository from templates/book-starter.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_PATTERNS, RedocsError, today } from './shared-helpers.mjs';

const templateRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'book-starter');
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.html', '.template', '']);
// npm drops dotfiles such as .gitignore from packages, so templates store them under a plain name.
const RENAMES = { 'gitignore.template': '.gitignore' };

function copyTemplate(from, to, tokens) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).sort()) {
    const source = path.join(from, name);
    const target = path.join(to, RENAMES[name] || name);
    if (statSync(source).isDirectory()) {
      copyTemplate(source, target, tokens);
    } else if (TEXT_EXTENSIONS.has(path.extname(name))) {
      const text = readFileSync(source, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in tokens ? tokens[key] : match));
      writeFileSync(target, text);
    } else {
      copyFileSync(source, target);
    }
  }
}

/**
 * @param {{dir: string, name: string, title?: string, language?: string, force?: boolean}} options
 */
export function initBook({ dir, name, title, language = 'en', force = false }) {
  if (!name || !ID_PATTERNS.slug.test(name)) {
    throw new RedocsError(`--name must be a lowercase slug (a-z, 0-9, -), got '${name ?? ''}'`, { code: 'ERR_REDOCS_ARGS' });
  }
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
    throw new RedocsError(`--language must look like 'en' or 'vi', got '${language}'`, { code: 'ERR_REDOCS_ARGS' });
  }
  const root = path.resolve(dir);
  if (existsSync(root)) {
    const entries = readdirSync(root).filter((entry) => entry !== '.git' && entry !== '.DS_Store');
    if (entries.length > 0 && !force) {
      throw new RedocsError(`Directory is not empty: ${root}`, {
        code: 'ERR_REDOCS_NOT_EMPTY',
        hint: 'Choose an empty directory (a fresh `git init` is fine) or pass --force to scaffold over existing files.',
      });
    }
    if (existsSync(path.join(root, 'book.json')) && force) {
      throw new RedocsError(`A book already exists at ${root}; refusing to overwrite book.json`, { code: 'ERR_REDOCS_EXISTS' });
    }
  }
  const tokens = {
    BOOK_ID: name,
    BOOK_TITLE: (title || `${name} System Design Book`).replace(/["\\]/g, ''),
    LANGUAGE: language,
    TODAY: today(),
  };
  copyTemplate(templateRoot, root, tokens);
  return { ok: true, command: 'init', book: root, id: name, title: tokens.BOOK_TITLE };
}
