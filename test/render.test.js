import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCase, renderDocument } from '../src/render.js';
import { makeCase, isolationTemplate } from './helpers.js';

const hmacStep = {
  id: 'STEP-hmac-sign-001',
  title: 'sign the payload',
  reads: ['payload'],
  produces: ['signature'],
  code: 'return {};',
};

const fullCase = () =>
  makeCase({
    id: 'CASE-render-001',
    title: '1.1 fetch my own request detail',
    setup: [
      { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { requestId: 'body.id' } },
      { step: 'STEP-hmac-sign-001', bind: { payload: 'x' } },
    ],
    test: {
      request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
      pollUntil: { until: { body: { status: 'COMPLETED' } } },
      expect: { status: 200, body: { id: '$requestId', result: { $any: 'string' }, status: 'COMPLETED' } },
    },
    teardown: { drain: true },
  });

test('a case renders as Given/When/Then with captures, polling, matchers, and lineage', () => {
  const md = renderCase(fullCase(), { steps: new Map([[hmacStep.id, hmacStep]]) });
  assert.match(md, /\*\*Given\*\*\s+POST \/groovy\/submit as user_1 with body/);
  assert.match(md, /captures requestId ← body\.id/);
  assert.match(md, /\*\*And\*\*\s+runs generated procedure STEP-hmac-sign-001 \(reads payload → produces signature\)/);
  assert.match(md, /\*\*When\*\*\s+GET \/groovy\/status\?id=\$requestId as user_1/);
  assert.match(md, /polling until the body matches/);
  assert.match(md, /\*\*Then\*\*\s+the response is 200, and the body matches .*<any string>/);
  assert.match(md, /\*\*Finally\*\* every captured job is drained/);
  assert.match(md, /From intent `inline` @ `abcdef`/);
});

test('anonymous and literal-credential auth render distinctly', () => {
  const anon = makeCase({ test: { request: { method: 'get', route: '/x' }, expect: { status: 401 } } });
  assert.match(renderCase(anon), /GET \/x anonymously/);
  const literal = makeCase({ test: { request: { method: 'get', route: '/x', auth: { username: 'u', password: '' } }, expect: { status: 401 } } });
  assert.match(renderCase(literal), /with credentials "u" \/ ""/);
});

test('a verdict annotates the case; failures carry diffs in words', () => {
  const verdict = { id: 'CASE-inline-test', verdict: 'fail', reason: 'test: assertion failed', diffs: [{ path: 'status', expected: 403, actual: 401, reason: 'status mismatch' }] };
  const md = renderCase(makeCase(), { verdict });
  assert.match(md, /^### ❌/m);
  assert.match(md, /\*\*Verdict: FAIL\*\*/);
  assert.match(md, /at `status`: expected 403, got 401/);
});

test('the document groups by intent, quotes sections, and renders templates + steps', () => {
  const sections = [{ id: 'inline', title: 'The inline section', text: 'Every probe must answer.' }];
  const md = renderDocument({
    loaded: [{ file: 'x', caseObj: makeCase() }],
    steps: new Map([[hmacStep.id, hmacStep]]),
    templates: new Map([[isolationTemplate().id, isolationTemplate()]]),
    sections,
  });
  assert.match(md, /^# Peira test cases/);
  assert.match(md, /## The inline section/);
  assert.match(md, /> Every probe must answer\./);
  assert.match(md, /## Invariant templates/);
  assert.match(md, /\*\*For any\*\* `submitter`: principal; `other`: principal \(distinct from `submitter`\)/);
  assert.match(md, /mints 5 seeded instances per run/);
  assert.match(md, /## Escape-hatch steps/);
  assert.match(md, /one-way documentation/);
});

test('evidence turns the document into a run report with minted cases', () => {
  const minted = { ...makeCase({ id: 'CASE-tpl-g0' }), from: { intent: 'inline', hash: 'abcdef', template: 'TPL-x-001', seed: 7, instance: 0 } };
  const evidenceText = [
    { event: 'run-start', seed: 7 },
    { event: 'case-start', case: 'CASE-inline-test', definition: makeCase() },
    { event: 'case-verdict', id: 'CASE-inline-test', verdict: 'pass' },
    { event: 'minted', template: 'TPL-x-001', seed: 7, instance: 0, case: minted },
    { event: 'case-verdict', id: 'CASE-tpl-g0', verdict: 'fail', reason: 'assertion failed', diffs: [] },
  ].map((e) => JSON.stringify(e)).join('\n');
  const md = renderDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText });
  assert.match(md, /^# Peira run report — seed 7: 1 pass \/ 1 fail \/ 0 error/);
  assert.match(md, /### ✅ CASE-inline-test/);
  assert.match(md, /## Minted from invariant templates/);
  assert.match(md, /### ❌ CASE-tpl-g0/);
  assert.match(md, /minted from TPL-x-001, seed 7, instance 0/);
});

test('deterministic: same inputs, byte-identical output', () => {
  const opts = { loaded: [{ file: 'x', caseObj: fullCase() }], steps: new Map([[hmacStep.id, hmacStep]]) };
  assert.equal(renderDocument(opts), renderDocument(opts));
});
