// The oracle discipline's enforcement surface (RFC §4.5): steps and invocations at the gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStep, validateCase, loadSteps } from '../src/validate.js';
import { makeCase } from './helpers.js';

const goodStep = (over = {}) => ({
  id: 'STEP-sign-001',
  reads: ['payload'],
  produces: ['signature'],
  code: "const sig = ctx.crypto.createHmac('sha256', 'k').update(inputs.payload).digest('hex'); return { signature: sig };",
  ...over,
});

test('a well-formed step passes', () => {
  assert.deepEqual(validateStep(goodStep()).errors, []);
});

test('the code lint refuses assertion vocabulary — a step that asserts is a schema violation', () => {
  for (const code of ['expect(x).toBe(1); return {};', 'assert(x === 1); return {};', 'x.should.equal(1); return {};']) {
    const { errors } = validateStep(goodStep({ code }));
    assert.ok(errors.some((e) => /invariant 3/.test(e)), `${code} must be refused: ${errors}`);
  }
});

test('the code lint refuses ambient access', () => {
  for (const code of ["const fs = require('fs'); return {};", "import fs from 'fs'; return {};", 'return { e: process.env.SECRET };', "ctx.aut; child_process; return {};"]) {
    const { errors } = validateStep(goodStep({ code }));
    assert.ok(errors.length > 0, `${code} must be refused`);
  }
});

test('step schema: bad id, bad alias names, missing contract fields refused', () => {
  assert.ok(validateStep(goodStep({ id: 'step-lower' })).errors.length > 0);
  assert.ok(validateStep(goodStep({ reads: ['not-an-identifier!'] })).errors.length > 0);
  assert.ok(validateStep({ id: 'STEP-x-001', code: 'return {};' }).errors.length > 0); // no reads/produces
});

test('an invocation cannot carry expect or capture — refused by shape', () => {
  const withExpect = makeCase({ setup: [{ step: 'STEP-sign-001', expect: { status: 200 } }] });
  const withCapture = makeCase({ setup: [{ step: 'STEP-sign-001', capture: { x: 'body.x' } }] });
  const steps = new Map([[goodStep().id, goodStep()]]);
  for (const c of [withExpect, withCapture]) {
    assert.ok(validateCase(c, { steps }).errors.length > 0);
  }
});

test('a test step can never be an invocation', () => {
  const c = makeCase({ test: { step: 'STEP-sign-001' } });
  assert.ok(validateCase(c, { steps: new Map([[goodStep().id, goodStep()]]) }).errors.length > 0);
});

test('invocation references: unknown step refused; reads must be bound or produced; produces chain forward', () => {
  const steps = new Map([[goodStep().id, goodStep()]]);
  const unknown = makeCase({ setup: [{ step: 'STEP-ghost-001' }] });
  assert.ok(validateCase(unknown, { steps }).errors.some((e) => /unknown step/.test(e)));

  const unbound = makeCase({ setup: [{ step: 'STEP-sign-001' }] });
  assert.ok(validateCase(unbound, { steps }).errors.some((e) => /reads "payload"/.test(e)));

  const chained = makeCase({
    setup: [{ step: 'STEP-sign-001', bind: { payload: 'x {{unique.nonce}}' } }],
    test: { request: { method: 'post', route: '/secure/echo', body: { payload: 'x {{unique.nonce}}', signature: '$signature' } }, expect: { status: 200 } },
  });
  assert.deepEqual(validateCase(chained, { steps }).errors, []);
});

test('loadSteps: registry loads valid steps, reports invalid ones by file', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'peira-steps-'));
  writeFileSync(join(dir, 'good.json'), JSON.stringify(goodStep()));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify(goodStep({ id: 'STEP-bad-001', code: 'assert(1); return {};' })));
  const { steps, results } = loadSteps(dir);
  assert.ok(steps.has('STEP-sign-001'));
  assert.ok(!steps.has('STEP-bad-001'));
  assert.equal(results.filter((r) => r.errors.length > 0).length, 1);
  const missing = loadSteps('/nonexistent-dir');
  assert.equal(missing.steps.size, 0);
});
