// RFC 0004 O3: a hand-written case may exist before it is stamped — warn, do not refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCase } from '../dist/validate.js';
import { checkStale } from '../dist/stale.js';
import { loadIntentDir } from '../dist/intent.js';
import { makeCase } from './helpers.js';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'peira.js');

test('the gate admits a case with from.intent and no hash, with a warning naming stamp', () => {
  const c = makeCase({ from: { intent: 'order-create' } });
  const { errors, warnings } = validateCase(c);
  assert.deepEqual(errors, []);
  assert.equal(warnings.filter((w) => /unstamped/.test(w)).length, 1);
  assert.match(warnings.find((w) => /unstamped/.test(w)), /peira stamp/);
  // still refused: no from at all, or a hash that is not hex
  assert.ok(validateCase({ ...makeCase(), from: undefined }).errors.length > 0);
  assert.ok(validateCase(makeCase({ from: { intent: 'x', hash: 'not-hex' } })).errors.length > 0);
});

test('checkStale routes a missing hash to unstamped, never to stale', () => {
  const sections = [{ id: 'order-create', hash: 'abcdef123456' }];
  const loaded = [
    { file: 'a.json', caseObj: makeCase({ id: 'CASE-a', from: { intent: 'order-create' } }) },
    { file: 'b.json', caseObj: makeCase({ id: 'CASE-b', from: { intent: 'order-create', hash: 'deadbeefdead' } }) },
  ];
  const r = checkStale(loaded, sections);
  assert.deepEqual(r.unstamped.map((u) => u.caseId), ['CASE-a']);
  assert.deepEqual(r.stale.map((s) => s.caseId), ['CASE-b']);
  assert.deepEqual(r.missing, []);
});

test('CLI: validate exits 0 on an unstamped case and says how to stamp it; stamp then makes it current', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-hw-'));
  mkdirSync(join(dir, 'cases')); mkdirSync(join(dir, 'intent'));
  writeFileSync(join(dir, 'intent', 'o.md'), '## Creating an order\n<!-- peira: id=order-create kind=ac -->\n\nPOST /orders returns 201.\n');
  writeFileSync(join(dir, 'cases', 'a.json'), JSON.stringify(makeCase({ id: 'CASE-order-create-001', from: { intent: 'order-create' } })));
  const x = promisify(execFile);
  const v = await x(process.execPath, [bin, 'validate', join(dir, 'cases'), '--intent', join(dir, 'intent')]);
  assert.match(v.stderr, /unstamped: from\.hash is missing/);
  assert.doesNotMatch(v.stderr, /STALE/, 'a never-stamped case is not reported as stale');
  await x(process.execPath, [bin, 'stamp', join(dir, 'cases'), '--intent', join(dir, 'intent')]);
  const v2 = await x(process.execPath, [bin, 'validate', join(dir, 'cases'), '--intent', join(dir, 'intent')]);
  assert.doesNotMatch(v2.stderr, /unstamped:/);
  const live = loadIntentDir(join(dir, 'intent'))[0].hash;
  assert.equal(JSON.parse((await import('node:fs')).readFileSync(join(dir, 'cases', 'a.json'), 'utf8')).from.hash, live);
});
