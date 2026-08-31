// `peira validate --intent` at the CLI level: stale detection is a documented promise
// ("stale flags name the affected cases"), and the promise is the console output plus the
// exit code, which unit tests on checkStale cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIntentDir } from '../dist/intent.js';

const execFileP = promisify(execFile);
const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'peira.js');

/** A project whose one case was compiled from `hash` of the live "orders" section. */
function project(hash) {
  const dir = mkdtempSync(join(tmpdir(), 'peira-validate-'));
  const casesDir = join(dir, 'cases');
  const intentDir = join(dir, 'intent');
  mkdirSync(casesDir);
  mkdirSync(intentDir);
  writeFileSync(join(intentDir, 'orders.md'), '## Creating an order\n<!-- peira: id=order-create kind=ac -->\n\nPOST /orders returns 201.\n');
  const liveHash = loadIntentDir(intentDir)[0].hash;
  writeFileSync(join(casesDir, 'c1.json'), JSON.stringify({
    id: 'CASE-order-create-001',
    from: { intent: 'order-create', hash: hash ?? liveHash },
    test: { request: { method: 'post', route: '/orders' }, expect: { status: 201, body: { id: { $any: 'string' } } } },
  }));
  return { casesDir, intentDir, liveHash };
}

const validate = (p, ...args) =>
  execFileP('node', [binPath, 'validate', p.casesDir, '--intent', p.intentDir, ...args], { encoding: 'utf8' }).catch((e) => e);

test('a case compiled from the live hash validates clean, exit 0', async () => {
  const r = await validate(project(null));
  assert.equal(r.code ?? 0, 0, r.stderr);
});

test('a stale case is named with both hashes and stays a warning, not an error', async () => {
  const p = project('deadbeef1234');
  const r = await validate(p);
  assert.equal(r.code ?? 0, 0, 'stale is a warning — the case still runs');
  assert.match(r.stderr, /CASE-order-create-001 is STALE/);
  assert.match(r.stderr, /deadbeef1234/); // the hash it was compiled from
  assert.match(r.stderr, new RegExp(p.liveHash)); // and what intent says now
});

test('a case whose intent section no longer exists is an ERROR and exits 1', async () => {
  const p = project(null);
  writeFileSync(join(p.intentDir, 'orders.md'), '## Something else entirely\n<!-- peira: id=other kind=ac -->\n\nGET /x returns 200.\n');
  const r = await validate(p);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /intent section "order-create" no longer exists/);
  assert.match(r.stderr, /1 error\(s\)/);
});
