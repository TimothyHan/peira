import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase, runCases } from '../dist/runner.js';
import { EvidenceLog } from '../dist/evidence.js';
import { httpRequest } from '../dist/http.js';
import { withFixture, makeCase } from './helpers.js';

const run = (caseObj, bed, url, seed = 1) =>
  runCase(caseObj, { bed, baseUrl: url, seed, evidence: new EvidenceLog(null) });

test('capture chaining: setup → capture → interpolated test, green end to end', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { requestId: 'body.id' } }],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
        pollUntil: { until: { body: { status: 'COMPLETED' } } },
        expect: { status: 200, body: { id: '$requestId', result: '2', status: 'COMPLETED' } },
      },
    });
    const verdict = await run(caseObj, bed, url);
    assert.equal(verdict.verdict, 'pass', verdict.reason);
  }));

test('an assertion mismatch is a fail with a named diff', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({
      test: { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, expect: { status: 418 } },
    });
    const verdict = await run(caseObj, bed, url);
    assert.equal(verdict.verdict, 'fail');
    assert.equal(verdict.diffs[0].path, 'status');
    assert.deepEqual({ expected: verdict.diffs[0].expected, actual: verdict.diffs[0].actual }, { expected: 418, actual: 200 });
  }));

test('pollUntil that never converges times out as fail — the service answered, the assertion never held', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { requestId: 'body.id' } }],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
        pollUntil: { until: { body: { status: 'NEVER_A_STATE' } }, timeoutMs: 400 },
      },
    });
    const verdict = await run(caseObj, bed, url);
    assert.equal(verdict.verdict, 'fail');
    assert.match(verdict.reason, /pollUntil/);
  }));

test('a capture path missing from the response is a fail naming the path', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { nope: 'body.doesNotExist' } }],
      test: { request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$nope' } }, expect: { status: 200 } },
    });
    const verdict = await run(caseObj, bed, url);
    assert.equal(verdict.verdict, 'fail');
    assert.match(verdict.reason, /body\.doesNotExist/);
  }));

test('teardown.drain leaves a clean queue: the very next job goes straight to IN_PROGRESS', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({
      setup: [
        { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: 'sleep(1000)' } }, capture: { one: 'body.id' } },
        { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: 'sleep(999)' } }, capture: { two: 'body.id' } },
        { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '4+5' } }, capture: { three: 'body.id' } },
      ],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$three' } },
        expect: { status: 200, body: { status: 'PENDING' } },
      },
      teardown: { drain: true },
    });
    const verdict = await run(caseObj, bed, url);
    assert.equal(verdict.verdict, 'pass', verdict.reason);

    const after = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: { username: 'user_1', password: 'pass_1' }, body: { code: 'sleep(1)' } });
    const state = await httpRequest({ baseUrl: url, method: 'get', route: '/groovy/status', query: { id: after.body.id }, auth: { username: 'user_1', password: 'pass_1' } });
    assert.equal(state.body.status, 'IN_PROGRESS', 'queue was not drained');
  }));

test('runCases: sequential order, per-case isolation of captures, summary counts', () =>
  withFixture(async ({ url }, bed) => {
    const first = makeCase({
      id: 'CASE-a',
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { requestId: 'body.id' } }],
      test: { request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } }, expect: { status: 200 } },
    });
    // second case must NOT see the first case's capture — validate would refuse it, and the
    // runner independently fails it: nothing leaks between cases
    const second = makeCase({
      id: 'CASE-b',
      test: { request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } }, expect: { status: 200 } },
    });
    const { verdicts, counts } = await runCases(
      [{ file: 'a', caseObj: first }, { file: 'b', caseObj: second }],
      { bed, baseUrl: url, seed: 1 },
    );
    assert.deepEqual(verdicts.map((v) => v.verdict), ['pass', 'fail']);
    assert.deepEqual(counts, { pass: 1, fail: 1, error: 0 });
  }));
