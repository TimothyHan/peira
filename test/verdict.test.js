// The verdict split (RFC 0001 §4.7): infrastructure failures are `error`, never `fail`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase, runCases } from '../src/runner.js';
import { EvidenceLog } from '../src/evidence.js';
import { startFixture } from './fixtures/server.js';
import { makeBed, makeCase } from './helpers.js';

const submitCase = (id = 'CASE-inline-test') =>
  makeCase({ id, test: { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, expect: { status: 200 } } });

test('an unreachable service yields error, never fail', async () => {
  const bed = makeBed('http://127.0.0.1:9'); // discard port — connection refused
  const verdict = await runCase(submitCase(), { bed, baseUrl: bed.baseUrl, seed: 1, evidence: new EvidenceLog(null) });
  assert.equal(verdict.verdict, 'error');
  assert.ok(!verdict.diffs, 'an infra error carries no assertion diffs');
});

test('killing the fixture mid-run: earlier cases keep their verdicts, later ones become error', async () => {
  const fixture = await startFixture();
  const bed = makeBed(fixture.url);
  const evidence = new EvidenceLog(null);

  const first = await runCase(submitCase('CASE-before-kill'), { bed, baseUrl: bed.baseUrl, seed: 1, evidence });
  assert.equal(first.verdict, 'pass');

  await fixture.close(); // the service dies mid-run
  const second = await runCase(submitCase('CASE-after-kill'), { bed, baseUrl: bed.baseUrl, seed: 1, evidence });
  assert.equal(second.verdict, 'error');
});

test('exit-code semantics live in counts: any non-pass is visible separately', async () => {
  const bed = makeBed('http://127.0.0.1:9');
  const { counts } = await runCases([{ file: 'x', caseObj: submitCase() }], { bed, baseUrl: bed.baseUrl, seed: 1 });
  assert.deepEqual(counts, { pass: 0, fail: 0, error: 1 });
});
