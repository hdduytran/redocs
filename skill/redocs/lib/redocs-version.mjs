// The skill's version (single source: package.json) and a small semver comparison.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

export const REDOCS_VERSION = JSON.parse(readFileSync(packageFile, 'utf8')).version;

/** A book without "redocsVersion" was written before the field existed: the first release. */
export const BASELINE_VERSION = '0.1.0';

export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** -1, 0 or 1, comparing MAJOR.MINOR.PATCH numerically. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** The version a loaded book declares, or the baseline when it has none. */
export function bookVersion(config) {
  return config && typeof config.redocsVersion === 'string' ? config.redocsVersion : BASELINE_VERSION;
}
