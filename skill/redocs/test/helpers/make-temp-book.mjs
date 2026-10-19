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

/**
 * Starter book with three milestones (v1 current, v2 planned, target), entities with a
 * lifecycle, Vietnamese prose with sections and a v2-only page. Used by the agent-query tests.
 */
export async function richBook(name = 'rich') {
  const { addEntity, addPage, addVariant } = await import('../../lib/command-add-page-entity-variant.mjs');
  const dir = starterBook(name);
  editJson(path.join(dir, 'book.json'), (c) => {
    c.milestones.splice(1, 0, { id: 'v2', label: 'v2', status: 'planned', description: 'Billing split out' });
  });
  addEntity({ book: dir, id: 'svc:gateway', type: 'service', name: 'Gateway', summary: 'Public entry point', dependsOn: ['svc:monolith'] });
  addEntity({ book: dir, id: 'svc:monolith', type: 'service', name: 'Monolith', until: 'v2', replacedBy: 'svc:billing' });
  addEntity({ book: dir, id: 'svc:billing', type: 'service', name: 'Billing', summary: 'Hóa đơn và thanh toán', since: 'v2', tech: ['Go', 'PostgreSQL'] });
  writeText(path.join(dir, 'pages/services/overview/index.md'), [
    '# Services',
    '',
    'Tổng quan các dịch vụ của hệ thống và ranh giới giữa chúng.',
    '',
    '## Billing',
    '',
    '[[svc:billing]] xử lý hóa đơn và thanh toán, lưu dữ liệu trong cơ sở dữ liệu PostgreSQL.',
    '',
    '### Retry policy',
    '',
    'Thanh toán lỗi được thử lại 3 lần với backoff.',
    '',
    '#### Notes',
    '',
    'Chi tiết nhỏ.',
    '',
    '## Gateway',
    '',
    '[[svc:gateway]] nhận mọi request từ internet. Xem [topology](page:network/topology).',
    '',
  ].join('\n'));
  editJson(path.join(dir, 'pages/vision/why/page.json'), (p) => { p.summary = 'Vì sao hệ thống tồn tại'; });
  addVariant({ book: dir, page: 'network/topology', milestone: 'v2' });
  writeText(path.join(dir, 'pages/network/topology/v2.md'), '# Topology v2\n\n## Zones\n\n[[svc:billing]] chạy trong private zone.\n');
  addPage({ book: dir, id: 'proposals/split-billing', title: 'Split billing', kind: 'proposal', chapter: 'proposals', variants: ['v2'] });
  writeText(path.join(dir, 'pages/proposals/split-billing/v2.md'), '# Split billing\n\nTách billing khỏi monolith ở v2.\n');
  return dir;
}
