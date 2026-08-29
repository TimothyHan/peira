// Invariant 8: verdicts are a function of (cases, seed, service state); $unique derives from the seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCases, uniqueValue } from '../dist/runner.js';
import { loadCases } from '../dist/load.js';
import { withFixture } from './helpers.js';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'cases');

test('$unique values reproduce by seed and differ across seeds', () => {
  assert.equal(uniqueValue(42, 'CASE-x', 'nonce'), uniqueValue(42, 'CASE-x', 'nonce'));
  assert.notEqual(uniqueValue(42, 'CASE-x', 'nonce'), uniqueValue(43, 'CASE-x', 'nonce'));
  assert.notEqual(uniqueValue(42, 'CASE-x', 'nonce'), uniqueValue(42, 'CASE-y', 'nonce'));
  assert.match(uniqueValue(42, 'CASE-x', 'nonce'), /^u[0-9a-f]{10}$/);
});

test('the full 2022 corpus: two same-seed runs against a fresh fixture produce identical verdicts', () =>
  withFixture(async ({ url, reset }, bed) => {
    const { loaded } = loadCases(casesDir);
    assert.equal(loaded.length, 26);

    const first = await runCases(loaded, { bed, baseUrl: url, seed: 42 });
    reset();
    const second = await runCases(loaded, { bed, baseUrl: url, seed: 42 });

    assert.deepEqual(first.counts, { pass: 26, fail: 0, error: 0 });
    assert.deepEqual(JSON.stringify(first.verdicts), JSON.stringify(second.verdicts));
  }));
