// Steps inside the runner: the hand-written HMAC case end-to-end, and verdict classification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from '../dist/runner.js';
import { EvidenceLog } from '../dist/evidence.js';
import { withFixture, makeCase, makeBed } from './helpers.js';

const SIGN_STEP = {
  id: 'STEP-hmac-sign-001',
  title: 'compute HMAC-SHA256 over the payload with the shared demo secret',
  reads: ['payload'],
  produces: ['signature'],
  code: "const sig = ctx.crypto.createHmac('sha256', 'peira-demo-secret').update(inputs.payload).digest('hex'); return { signature: sig };",
};

// the same {{unique.nonce}} resolves identically in bind and body — seed-derived, per (case, key)
const hmacCase = (stepId = SIGN_STEP.id) =>
  makeCase({
    id: 'CASE-hmac-echo-001',
    setup: [{ step: stepId, bind: { payload: 'hello {{unique.nonce}}' } }],
    test: {
      request: {
        method: 'post',
        route: '/secure/echo',
        auth: '$users.user_1',
        body: { payload: 'hello {{unique.nonce}}', signature: '$signature' },
      },
      expect: { status: 200, body: { echo: 'hello {{unique.nonce}}', verified: true } },
    },
  });

const run = (caseObj, bed, url, steps, evidence = new EvidenceLog(null)) =>
  runCase(caseObj, { bed, baseUrl: url, seed: 7, evidence, steps });

test('the HMAC case runs green end-to-end: bind → child process → produced value → declarative expect', () =>
  withFixture(async ({ url }, bed) => {
    const evidence = new EvidenceLog(null);
    const steps = new Map([[SIGN_STEP.id, SIGN_STEP]]);
    const verdict = await run(hmacCase(), bed, url, steps, evidence);
    assert.equal(verdict.verdict, 'pass', verdict.reason);
    const stepEvent = evidence.events.find((e) => e.event === 'step');
    assert.equal(stepEvent.step, SIGN_STEP.id);
    assert.ok(!JSON.stringify(stepEvent).includes('createHmac'), 'evidence carries the contract, not the code');
  }));

test('a wrong signature fails declaratively — the claim lives in expect, not in the step', () =>
  withFixture(async ({ url }, bed) => {
    const badStep = { ...SIGN_STEP, id: 'STEP-hmac-wrong-001', code: "return { signature: 'deadbeef' };" };
    const caseObj = hmacCase(badStep.id);
    const verdict = await run(caseObj, bed, url, new Map([[badStep.id, badStep]]));
    assert.equal(verdict.verdict, 'fail');
    assert.equal(verdict.diffs[0].path, 'status'); // 400 invalid signature vs expected 200
  }));

test('a step that breaks its contract (missing produced value) is a fail naming the step', () =>
  withFixture(async ({ url }, bed) => {
    const broken = { ...SIGN_STEP, id: 'STEP-broken-001', code: 'return {};' };
    const verdict = await run(hmacCase(broken.id), bed, url, new Map([[broken.id, broken]]));
    assert.equal(verdict.verdict, 'fail');
    assert.match(verdict.reason, /broke its contract.*signature/);
  }));

test('undeclared outputs are dropped with a warning event, the case still passes', () =>
  withFixture(async ({ url }, bed) => {
    const chatty = { ...SIGN_STEP, id: 'STEP-chatty-001', code: SIGN_STEP.code.replace('return { signature: sig };', "return { signature: sig, debug: 'x' };") };
    const evidence = new EvidenceLog(null);
    const verdict = await run(hmacCase(chatty.id), bed, url, new Map([[chatty.id, chatty]]), evidence);
    assert.equal(verdict.verdict, 'pass', verdict.reason);
    assert.deepEqual(evidence.events.find((e) => e.event === 'step').droppedOutputs, ['debug']);
  }));

test('an aut network failure inside a step is an error verdict, never a fail', async () => {
  const bed = makeBed('http://127.0.0.1:9');
  const netStep = { ...SIGN_STEP, id: 'STEP-net-001', reads: [], code: "await ctx.aut({ method: 'get', route: '/x' }); return { signature: 'x' };" };
  const caseObj = hmacCase(netStep.id);
  delete caseObj.setup[0].bind;
  const verdict = await run(caseObj, bed, bed.baseUrl, new Map([[netStep.id, netStep]]));
  assert.equal(verdict.verdict, 'error');
});
