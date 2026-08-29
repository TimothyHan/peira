import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, codeSkeleton, formatStats } from '../src/stats.js';
import { makeCase } from './helpers.js';

const declarative = (id) => ({ file: `${id}.json`, caseObj: makeCase({ id }) });
const withStep = (id, stepId) => ({
  file: `${id}.json`,
  caseObj: makeCase({ id, setup: [{ step: stepId, bind: { payload: 'x' } }] }),
});
const step = (id, code) => ({ id, reads: ['payload'], produces: ['out'], code });

test('coverage math: declarative fraction of the suite', () => {
  const loaded = [declarative('CASE-a-001'), declarative('CASE-b-001'), withStep('CASE-c-001', 'STEP-x-001')];
  const stats = computeStats(loaded, new Map([['STEP-x-001', step('STEP-x-001', 'return { out: 1 };')]]));
  assert.deepEqual(
    { total: stats.total, declarative: stats.declarative, withSteps: stats.withSteps },
    { total: 3, declarative: 2, withSteps: 1 },
  );
  assert.ok(Math.abs(stats.coverage - 2 / 3) < 1e-9);
});

test('a pure-declarative corpus reports 100% and no shapes', () => {
  const stats = computeStats([declarative('CASE-a-001')], new Map());
  assert.equal(stats.coverage, 1);
  assert.deepEqual(stats.recurring, []);
});

test('skeletons normalize identifiers and literals but keep structure', () => {
  const a = codeSkeleton("const sig = ctx.crypto.createHmac('sha256', 'k1').update(inputs.payload).digest('hex'); return { signature: sig };");
  const b = codeSkeleton("const mac = ctx.crypto.createHmac('sha512', 'other').update(inputs.body).digest('base64'); return { token: mac };");
  const c = codeSkeleton('return { out: inputs.a + 1 };');
  assert.equal(a, b, 'same structure, different names/literals — same shape');
  assert.notEqual(a, c);
});

test('recurring shapes group and rank — the DSL asking for a primitive with evidence', () => {
  const s1 = step('STEP-sign-a-001', "return { out: ctx.crypto.createHmac('sha256', 'k').update(inputs.payload).digest('hex') };");
  const s2 = step('STEP-sign-b-001', "return { out: ctx.crypto.createHmac('sha512', 'j').update(inputs.payload).digest('hex') };");
  const s3 = step('STEP-other-001', 'return { out: 1 };');
  const stats = computeStats([], new Map([[s1.id, s1], [s2.id, s2], [s3.id, s3]]));
  assert.equal(stats.recurring.length, 1);
  assert.deepEqual(stats.recurring[0].ids.sort(), ['STEP-sign-a-001', 'STEP-sign-b-001']);
  assert.match(formatStats(stats), /recurring fallback shapes/);
});
