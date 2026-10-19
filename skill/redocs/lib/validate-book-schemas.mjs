// JSON Schema validation for book.json, page.json, entity files, receipts and plugin manifests.

import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostic } from './shared-helpers.mjs';

const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const SCHEMA_FILES = {
  book: 'book.schema.json',
  page: 'page.schema.json',
  entityFile: 'entity-file.schema.json',
  receipt: 'artifact-receipt.schema.json',
  plugin: 'plugin.schema.json',
  comment: 'comment.schema.json',
};

let compiled;
function validators() {
  if (compiled) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  compiled = {};
  for (const [name, file] of Object.entries(SCHEMA_FILES)) {
    compiled[name] = ajv.compile(JSON.parse(readFileSync(path.join(schemaDir, file), 'utf8')));
  }
  return compiled;
}

function describe(error) {
  if (error.keyword === 'additionalProperties') return `unknown property '${error.params.additionalProperty}'`;
  if (error.keyword === 'enum') return `${error.message}: ${error.params.allowedValues.join(', ')}`;
  return error.message;
}

/**
 * Validate `value` against one of the bundled schemas.
 * @param {'book'|'page'|'entityFile'|'receipt'|'plugin'|'comment'} kind
 * @returns {import('./shared-helpers.mjs').Diagnostic[]}
 */
export function validateAgainstSchema(kind, value, file) {
  const validate = validators()[kind];
  if (validate(value)) return [];
  return validate.errors.map((error) => diagnostic('RD001', 'error', `Schema: ${describe(error)}`, {
    file,
    pointer: error.instancePath || '/',
    hint: `See schemas/${SCHEMA_FILES[kind]}`,
  }));
}
