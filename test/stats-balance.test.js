// RFC 0005 P1: "do we test the failure paths?" answered on every run, per intent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBalance, computeStats, formatStats } from '../dist/stats.js';
import { loadCases } from '../dist/load.js';
import { makeCase } from './helpers.js';

const c = (id, intent, expect) => ({ file: id, caseObj: makeCase({ id, from: { intent, hash: 'abcdef' }, test: { request: { method: 'get', route: '/x' }, expect } }) });

test('classification: status < 400 positive, >= 400 negative, $absent/$notContains a negative oracle, no status unclassified', () => {
  const b = computeBalance([
    c('CASE-a1', 'alpha', { status: 200, body: { ok: true } }),
    c('CASE-a2', 'alpha', { status: 201 }),
    c('CASE-b1', 'beta', { status: 403 }),
    c('CASE-b2', 'beta', { status: 200, body: { users: { create: { $absent: true } } } }),
    c('CASE-g1', 'gamma', { status: 307, headers: { location: { $notContains: 'evil' } } }),
    { file: 'p', caseObj: makeCase({ id: 'CASE-p', from: { intent: 'poll', hash: 'abcdef' }, test: { request: { method: 'get', route: '/x' }, pollUntil: { until: { body: { s: 'DONE' } } } } }) },
    { file: 'u', caseObj: makeCase({ id: 'CASE-u', from: undefined, test: { request: { method: 'get', route: '/x' }, expect: { status: 404 } } }) },
  ]);
  const by = Object.fromEntries(b.intents.map((r) => [r.intent, r]));
  assert.deepEqual(by.alpha, { intent: 'alpha', cases: 2, positive: 2, negative: 0, negativeOracle: 0, unclassified: 0 });
  assert.deepEqual(by.beta, { intent: 'beta', cases: 2, positive: 1, negative: 1, negativeOracle: 1, unclassified: 0 });
  assert.deepEqual(by.gamma, { intent: 'gamma', cases: 1, positive: 1, negative: 0, negativeOracle: 1, unclassified: 0 });
  assert.deepEqual(by.poll, { intent: 'poll', cases: 1, positive: 0, negative: 0, negativeOracle: 0, unclassified: 1 });
  assert.deepEqual(by['(unbound)'], { intent: '(unbound)', cases: 1, positive: 0, negative: 1, negativeOracle: 0, unclassified: 0 });
  assert.deepEqual(b.total, { intent: 'total', cases: 7, positive: 4, negative: 2, negativeOracle: 2, unclassified: 1 });
  assert.deepEqual(b.positiveOnly, ['alpha'], 'gamma is not positive-only: its 307 carries a negative oracle');
  assert.deepEqual(b.intents.map((r) => r.intent), ['(unbound)', 'alpha', 'beta', 'gamma', 'poll'], 'sorted');
});

test('formatStats prints the table, a total row, the unclassified column only when needed, and the happy-path flag', () => {
  const out = formatStats(computeStats([c('CASE-a', 'alpha', { status: 200 }), c('CASE-b', 'beta', { status: 403 })], new Map()));
  assert.match(out, /refusal balance/);
  assert.match(out, /intent\s+cases\s+positive\s+negative\s+negative-oracle\n/);
  assert.doesNotMatch(out, /unclassified/, 'column hidden when every case has a status');
  assert.match(out, /^\s+alpha\s+1\s+1\s+0\s+0$/m);
  assert.match(out, /^\s+total\s+2\s+1\s+1\s+0$/m);
  assert.match(out, /1 intent\(s\) test only the happy path: alpha/);
  const withPoll = formatStats(computeStats([{ file: 'p', caseObj: makeCase({ id: 'CASE-p', test: { request: { method: 'get', route: '/x' }, pollUntil: { until: { body: {} } } } }) }], new Map()));
  assert.match(withPoll, /unclassified/);
});

test("the repo's own corpus classifies completely and shows its own skew", () => {
  const { loaded } = loadCases('cases');
  const b = computeBalance(loaded);
  assert.equal(b.total.unclassified, 0);
  assert.equal(b.total.cases, loaded.length);
  assert.ok(b.total.negative > 0 && b.total.positive > 0);
});
