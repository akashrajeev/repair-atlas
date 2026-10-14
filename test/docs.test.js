import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPS } from '../src/ops.js';
import { compile } from '../src/model.js';

const doc = readFileSync(new URL('../docs/workflow-format.md', import.meta.url), 'utf8');

test('workflow-format doc lists every operation and its example compiles', () => {
  for (const op of Object.keys(OPS)) assert.ok(doc.includes(`| ${op} |`), `op ${op} missing from docs (run node scripts/gen-docs.js)`);
  const json = doc.match(/```json\n([\s\S]*?)\n```/)[1];
  assert.ok(compile(JSON.parse(json)));
});
