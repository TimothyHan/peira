import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCase, validateCaseSet } from '../src/validate.js';
import { loadCases, listCaseFiles } from '../src/load.js';
import { makeCase, makeBed } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const bedUsers = makeBed('http://x').users;

test('every refusal fixture is refused with a named error', () => {
  const files = listCaseFiles(join(here, 'refusals'));
  assert.ok(files.length >= 8, 'refusal fixtures present');
  for (const file of files) {
    const caseObj = JSON.parse(readFileSync(file, 'utf8'));
    const { errors } = validateCase(caseObj, { bedUsers });
    assert.ok(errors.length > 0, `${basename(file)} must be refused`);
  }
});

test('the sleep refusal names the fix', () => {
  const caseObj = JSON.parse(readFileSync(join(here, 'refusals', 'sleep.json'), 'utf8'));
  const { errors } = validateCase(caseObj);
  assert.ok(errors.some((e) => /pollUntil/.test(e)), `error should point at pollUntil: ${errors}`);
});

test('unresolved alias is refused before any request could be sent', () => {
  const caseObj = JSON.parse(readFileSync(join(here, 'refusals', 'unresolved-alias.json'), 'utf8'));
  const { errors } = validateCase(caseObj);
  assert.ok(errors.some((e) => /\$neverCaptured/.test(e)), String(errors));
});

test('captures become available in lexical order — later steps may use them, earlier may not', () => {
  const good = makeCase({
    setup: [{ request: { method: 'post', route: '/submit' }, capture: { requestId: 'body.id' } }],
    test: { request: { method: 'get', route: '/status', query: { id: '$requestId' } }, expect: { status: 200 } },
  });
  assert.deepEqual(validateCase(good).errors, []);

  const backwards = makeCase({
    setup: [{ request: { method: 'get', route: '/status', query: { id: '$requestId' } }, capture: { requestId: 'body.id' } }],
  });
  assert.ok(validateCase(backwards).errors.length > 0, 'a step cannot reference its own capture');
});

test('unknown bed principal is refused when a bed config is at hand', () => {
  const caseObj = makeCase({ test: { request: { method: 'get', route: '/x', auth: '$users.ghost' }, expect: { status: 200 } } });
  assert.deepEqual(validateCase(caseObj).errors, []); // no bed — nothing to check against
  assert.ok(validateCase(caseObj, { bedUsers }).errors.some((e) => /ghost/.test(e)));
});

test('weak-oracle warnings: status-only and empty-body expects warn but pass', () => {
  const statusOnly = makeCase();
  const emptyBody = makeCase({ test: { request: { method: 'get', route: '/x' }, expect: { status: 200, body: {} } } });
  for (const c of [statusOnly, emptyBody]) {
    const { errors, warnings } = validateCase(c);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /weak oracle/);
  }
});

test('drain with nothing captured warns', () => {
  const { warnings } = validateCase(makeCase({ teardown: { drain: true } }));
  assert.ok(warnings.some((w) => /drain/.test(w)));
});

test('duplicate case ids are refused across the set', () => {
  const a = { file: 'a.json', caseObj: makeCase() };
  const b = { file: 'b.json', caseObj: makeCase() };
  const { ok, results } = validateCaseSet([a, b]);
  assert.equal(ok, false);
  assert.ok(results[1].errors.some((e) => /duplicate/.test(e)));
});

test('the 2022 corpus validates clean: zero errors, exactly the two known weak-oracle warnings', () => {
  const { loaded, parseErrors } = loadCases(join(here, '..', 'cases'));
  assert.deepEqual(parseErrors, []);
  assert.equal(loaded.length, 26);
  const { ok, results } = validateCaseSet(loaded, { bedUsers });
  assert.equal(ok, true, JSON.stringify(results.flatMap((r) => r.errors)));
  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.id}: ${w}`));
  assert.equal(warnings.length, 2, JSON.stringify(warnings));
  assert.ok(warnings.every((w) => /CASE-2022-1-[34]/.test(w)));
});
