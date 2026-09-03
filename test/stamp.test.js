// RFC 0003 P1: zero-LLM lineage binding. from.intent is the human's; from.hash never is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStamp, applyStamp } from '../dist/stamp.js';
import { loadIntentDir } from '../dist/intent.js';
import { loadCases } from '../dist/load.js';
import { validateCase } from '../dist/validate.js';

const execFileP = promisify(execFile);
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'peira.js');
const INTENT = '## Creating an order\n<!-- peira: id=order-create kind=ac -->\n\nPOST /orders returns 201.\n\n## Listing orders\n<!-- peira: id=order-list kind=ac -->\n\nGET /orders returns 200.\n';

function project(cases) {
  const dir = mkdtempSync(join(tmpdir(), 'peira-stamp-'));
  mkdirSync(join(dir, 'cases'));
  mkdirSync(join(dir, 'intent'));
  writeFileSync(join(dir, 'intent', 'orders.md'), INTENT);
  for (const [name, c] of Object.entries(cases)) writeFileSync(join(dir, 'cases', name), JSON.stringify(c, null, 2) + '\n');
  return dir;
}
const caseFor = (intent, from) => ({
  id: `CASE-${intent}-001`,
  title: 'hand-written',
  from: from === undefined ? { intent } : { intent, ...from },
  test: { request: { method: 'get', route: '/orders' }, expect: { status: 200, body: { id: { $any: 'string' } } } },
});

test('plan: fills a missing hash, refreshes a stale one, leaves a current one, reports a missing section', () => {
  const dir = project({
    'a.json': caseFor('order-create'),                          // no hash yet
    'b.json': caseFor('order-list', { hash: 'deadbeefdead' }),  // stale
    'c.json': { ...caseFor('order-list'), from: undefined },    // unbound
    'd.json': caseFor('order-gone', { hash: 'x' }),             // no such section
  });
  const sections = loadIntentDir(join(dir, 'intent'));
  const live = Object.fromEntries(sections.map((s) => [s.id, s.hash]));
  const { loaded } = loadCases(join(dir, 'cases'));
  // one current case too
  loaded.push({ file: join(dir, 'cases', 'e.json'), caseObj: caseFor('order-create', { hash: live['order-create'] }) });

  const plan = planStamp(loaded, sections);
  assert.deepEqual(plan.changes.map((c) => [c.caseId, c.from, c.to]), [
    ['CASE-order-create-001', undefined, live['order-create']],
    ['CASE-order-list-001', 'deadbeefdead', live['order-list']],
  ]);
  assert.deepEqual(plan.missing.map((m) => m.intent), ['order-gone']);
  assert.equal(plan.unbound, 1);
  assert.equal(plan.current, 1);
});

test('apply: rewrites only the changed files, in compile\'s format, preserving key order and intent', () => {
  const dir = project({ 'a.json': caseFor('order-create'), 'b.json': caseFor('order-list', { hash: 'deadbeefdead' }) });
  const sections = loadIntentDir(join(dir, 'intent'));
  const { loaded } = loadCases(join(dir, 'cases'));
  const before = readFileSync(join(dir, 'cases', 'a.json'), 'utf8');
  const plan = planStamp(loaded, sections);
  applyStamp(plan, loaded);

  const a = readFileSync(join(dir, 'cases', 'a.json'), 'utf8');
  const parsed = JSON.parse(a);
  assert.equal(parsed.from.intent, 'order-create', 'intent untouched');
  assert.equal(parsed.from.hash, sections.find((s) => s.id === 'order-create').hash);
  assert.deepEqual(Object.keys(parsed), ['id', 'title', 'from', 'test'], 'key order preserved');
  assert.ok(a.endsWith('}\n') && a.includes('\n  "from": {'), 'two-space indent + trailing newline, like compile');
  assert.notEqual(a, before);
  // and the stamped case now passes the gate the hand-written one could not
  assert.deepEqual(validateCase(parsed).errors, []);
  // idempotent
  assert.equal(planStamp(loadCases(join(dir, 'cases')).loaded, sections).changes.length, 0);
});

test('CLI: --check exits 1 while anything would change, 0 after stamping; missing intent refuses', async () => {
  const dir = project({ 'a.json': caseFor('order-create') });
  const args = ['stamp', join(dir, 'cases'), '--intent', join(dir, 'intent')];

  const check1 = await execFileP(process.execPath, [bin, ...args, '--check']).catch((e) => e);
  assert.equal(check1.code, 1);
  assert.match(check1.stdout, /would stamp .*CASE-order-create-001 ← order-create @ [0-9a-f]{12} \(no hash yet\)/);
  assert.match(check1.stdout, /1 to stamp, 0 current/);

  const stamp = await execFileP(process.execPath, [bin, ...args]);
  assert.match(stamp.stdout, /^stamped /m);

  const check2 = await execFileP(process.execPath, [bin, ...args, '--check']);
  assert.match(check2.stdout, /0 to stamp, 1 current/);

  writeFileSync(join(dir, 'cases', 'z.json'), JSON.stringify(caseFor('order-gone')));
  const missing = await execFileP(process.execPath, [bin, ...args]).catch((e) => e);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /intent section "order-gone" does not exist/);
  assert.match(missing.stderr, /refused/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'cases', 'z.json'), 'utf8')).from.hash, undefined, 'a refused run writes nothing');

  const noIntent = await execFileP(process.execPath, [bin, 'stamp', join(dir, 'cases')]).catch((e) => e);
  assert.equal(noIntent.code, 2);
});
