import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../dist/intent.js';
import { checkStale } from '../dist/stale.js';

const original = parseIntent('## Submit works\n\nSubmitting returns an id.\n');
const caseFor = (section) => ({
  file: 'x.json',
  caseObj: { id: 'CASE-x-001', from: { intent: section.id, hash: section.hash } },
});

test('untouched intent: silent', () => {
  const { stale, missing } = checkStale([caseFor(original[0])], original);
  assert.deepEqual({ stale, missing }, { stale: [], missing: [] });
});

test('edited section text: stale, naming case and both hashes', () => {
  const edited = parseIntent('## Submit works\n\nSubmitting returns the NEW id shape.\n');
  const { stale } = checkStale([caseFor(original[0])], edited);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].caseId, 'CASE-x-001');
  assert.equal(stale[0].caseHash, original[0].hash);
  assert.equal(stale[0].liveHash, edited[0].hash);
});

test('deleted section: missing (a hard error at the CLI)', () => {
  const { missing } = checkStale([caseFor(original[0])], []);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].intent, 'submit-works');
});

test('hand-written lineage pointing outside the intent dir is missing too — the flag is opt-in', () => {
  const { missing } = checkStale(
    [{ file: 'y.json', caseObj: { id: 'CASE-y-001', from: { intent: '2022-test-plan/1.1', hash: 'abcdef123456' } } }],
    original,
  );
  assert.equal(missing.length, 1);
});
