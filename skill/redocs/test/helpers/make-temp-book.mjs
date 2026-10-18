// Test helpers: scaffold throwaway books and mutate their JSON files.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { initBook } from '../../lib/command-init-book.mjs';

const created = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'redocs-test-') {
  const dir = mkdtempSync(path.join(process.env.KIROCREW_SCRATCH || tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** A fresh starter book (v1 current + target, six pages). */
export function starterBook(name = 'demo') {
  const dir = path.join(tempDir(), name);
  initBook({ dir, name });
  return dir;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function editJson(file, mutate) {
  const value = readJson(file);
  const result = mutate(value) ?? value;
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
