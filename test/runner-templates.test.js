// Minted cases against the live fixture: the isolation invariant probes BUG-2022-01 fresh
// every run; the submit invariant asserts exact generated results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCases } from '../src/runner.js';
import { validateTemplate } from '../src/validate.js';
import { withFixture } from './helpers.js';
import { isolationTemplate } from './helpers.js';

const submitTemplate = () => ({
  id: 'TPL-submit-any-valid-script-001',
  from: { intent: 'submit-accepts-any-valid-script', hash: 'abcdef123456' },
  holes: {
    who: { kind: 'principal' },
    script: { kind: 'expression' },
  },
  setup: [{
    request: { method: 'post', route: '/groovy/submit', auth: '$holes.who', body: { code: '{{holes.script.code}}' } },
    capture: { requestId: 'body.id' },
  }],
  test: {
    request: { method: 'get', route: '/groovy/status', auth: '$holes.who', query: { id: '$requestId' } },
    pollUntil: { until: { body: { status: 'COMPLETED' } } },
    expect: { status: 200, body: { id: '$requestId', status: 'COMPLETED', result: '{{holes.script.result}}' } },
  },
});

test('the submit invariant mints 5 passing instances asserting exact generated results', () =>
  withFixture(async ({ url }, bed) => {
    assert.deepEqual(validateTemplate(submitTemplate(), { bedUsers: bed.users }).errors, []);
    const templates = new Map([[submitTemplate().id, submitTemplate()]]);
    const { verdicts, counts } = await runCases([], { bed, baseUrl: url, seed: 42, templates });
    assert.deepEqual(counts, { pass: 5, fail: 0, error: 0 });
    assert.ok(verdicts.every((v) => /-g\d$/.test(v.id)));
  }));

test('the isolation invariant mints 5 fresh probes of BUG-2022-01 — all fail 401-vs-403', () =>
  withFixture(async ({ url }, bed) => {
    const templates = new Map([[isolationTemplate().id, isolationTemplate()]]);
    const { verdicts, counts } = await runCases([], { bed, baseUrl: url, seed: 42, templates });
    assert.deepEqual(counts, { pass: 0, fail: 5, error: 0 });
    for (const v of verdicts) {
      assert.deepEqual({ expected: v.diffs[0].expected, actual: v.diffs[0].actual }, { expected: 403, actual: 401 });
    }
  }));

test('evidence carries each minted case in full; verdict provenance names (template, seed, instance)', () =>
  withFixture(async ({ url }, bed) => {
    const templates = new Map([[submitTemplate().id, submitTemplate()]]);
    const { events } = await runCases([], { bed, baseUrl: url, seed: 7, templates });
    const minted = events.filter((e) => e.event === 'minted');
    assert.equal(minted.length, 5);
    assert.deepEqual(minted.map((m) => m.instance), [0, 1, 2, 3, 4]);
    assert.equal(minted[0].case.from.template, submitTemplate().id);
    assert.equal(minted[0].case.from.seed, 7);
  }));

test('same seed, fresh fixture → identical verdict sequences including minted cases', () =>
  withFixture(async ({ url, reset }, bed) => {
    const templates = new Map([
      [isolationTemplate().id, isolationTemplate()],
      [submitTemplate().id, submitTemplate()],
    ]);
    const first = await runCases([], { bed, baseUrl: url, seed: 42, templates });
    reset();
    const second = await runCases([], { bed, baseUrl: url, seed: 42, templates });
    assert.equal(JSON.stringify(first.verdicts), JSON.stringify(second.verdicts));
    assert.deepEqual(first.counts, { pass: 5, fail: 5, error: 0 });
  }));
