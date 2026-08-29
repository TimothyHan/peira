// The compiler's escape protocol: steps through the gate, assertions refused, demand recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSections, buildContract } from '../src/compile.js';
import { parseIntent } from '../src/intent.js';

const sections = parseIntent('## Signed echo\n\nRequests must carry an HMAC signature.\n');

const stepCandidate = (over = {}) => ({
  id: 'STEP-hmac-sign-001',
  reads: ['payload'],
  produces: ['signature'],
  code: "const sig = ctx.crypto.createHmac('sha256', 'peira-demo-secret').update(inputs.payload).digest('hex'); return { signature: sig };",
  ...over,
});

const caseCandidate = () => ({
  id: 'CASE-signed-echo-001',
  title: 'signed echo verifies',
  setup: [{ step: 'STEP-hmac-sign-001', bind: { payload: 'x {{unique.nonce}}' } }],
  test: {
    request: { method: 'post', route: '/secure/echo', body: { payload: 'x {{unique.nonce}}', signature: '$signature' } },
    expect: { status: 200, body: { verified: true } },
  },
});

test('an emitted step passes both gates; the manifest records the escape; lineage is mechanical', async () => {
  const { accepted, acceptedSteps, manifest } = await compileSections(sections, {
    llm: async () => JSON.stringify({ cases: [caseCandidate()], steps: [stepCandidate({ from: { intent: 'LIES', hash: 'abcdef123456' } })] }),
  });
  assert.equal(accepted.length, 1);
  assert.equal(acceptedSteps.length, 1);
  assert.deepEqual(acceptedSteps[0].stepObj.from, { intent: 'signed-echo', hash: sections[0].hash });
  assert.deepEqual(manifest.sections[0].steps, ['STEP-hmac-sign-001']);
});

test('an asserting step is refused with the lint error in the manifest; its case falls with it', async () => {
  const asserting = stepCandidate({ code: "expect(inputs.payload).toBeDefined(); return { signature: 'x' };" });
  const { accepted, acceptedSteps, manifest } = await compileSections(sections, {
    llm: async () => JSON.stringify({ cases: [caseCandidate()], steps: [asserting] }),
  });
  assert.equal(acceptedSteps.length, 0);
  assert.ok(manifest.sections[0].refusedSteps[0].errors.some((e) => /invariant 3/.test(e)));
  assert.equal(accepted.length, 0); // the case references a step that never made it through
  assert.ok(manifest.sections[0].refused[0].errors.some((e) => /unknown step/.test(e)));
});

test('cases may reference steps from the existing registry, not just this compile', async () => {
  const registry = new Map([[stepCandidate().id, stepCandidate()]]);
  const { accepted } = await compileSections(sections, {
    steps: registry,
    llm: async () => JSON.stringify({ cases: [caseCandidate()] }),
  });
  assert.equal(accepted.length, 1);
});

test('the contract documents the escape protocol and its last-resort posture', () => {
  const contract = buildContract({});
  assert.match(contract, /LAST RESORT/);
  assert.match(contract, /NEVER asserts/);
  assert.match(contract, /ctx\.crypto/);
});
