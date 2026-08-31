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

test('header assertions run against the live response: case-insensitive, $contains, fail with diff', () =>
  withFixture(async ({ url }, bed) => {
    const good = makeCase({
      test: {
        request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } },
        expect: { status: 200, headers: { 'Content-Type': { $contains: 'application/json' } } },
      },
    });
    assert.equal((await run(good, bed, url)).verdict, 'pass');

    const bad = makeCase({
      test: {
        request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } },
        expect: { status: 200, headers: { 'x-request-id': { $any: 'string' } } },
      },
    });
    const verdict = await run(bad, bed, url);
    assert.equal(verdict.verdict, 'fail');
    assert.equal(verdict.diffs[0].path, 'headers.x-request-id');
    assert.equal(verdict.diffs[0].reason, 'missing header');
  }));

test('runCases filter: --only semantics — the unselected case never runs, counts reflect the selection', () =>
  withFixture(async ({ url }, bed) => {
    const a = makeCase({ id: 'CASE-a', test: { request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: 'nope' } }, expect: { status: 400 } } });
    const b = makeCase({ id: 'CASE-b', test: { request: { method: 'get', route: '/nowhere', auth: '$users.user_1' }, expect: { status: 200 } } }); // would fail if run
    const { verdicts, counts, events } = await runCases(
      [{ file: 'a', caseObj: a }, { file: 'b', caseObj: b }],
      { bed, baseUrl: url, seed: 1, filter: (id) => id === 'CASE-a' },
    );
    assert.deepEqual(verdicts.map((v) => v.id), ['CASE-a']);
    assert.deepEqual(counts, { pass: 1, fail: 0, error: 0 });
    const start = events.find((e) => e.event === 'run-start');
    assert.equal(start.cases, 1);
    assert.equal(start.casesTotal, 2);
    assert.ok(!events.some((e) => e.case === 'CASE-b'), 'the filtered-out case must leave no evidence');
  }));

test('runCases parallel: same verdicts in the same order, evidence grouped per case as if serial', () =>
  withFixture(async ({ url }, bed) => {
    const mk = (n, code, expectStatus) => makeCase({
      id: `CASE-p${n}`,
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code } }, capture: { requestId: 'body.id' } }],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
        expect: { status: expectStatus },
      },
    });
    const cases = [mk(1, '1+1', 200), mk(2, '2+2', 200), mk(3, '3+3', 418), mk(4, '4+4', 200)];
    const loaded = cases.map((c) => ({ file: c.id, caseObj: c }));

    const serial = await runCases(loaded, { bed, baseUrl: url, seed: 7 });
    const parallel = await runCases(loaded, { bed, baseUrl: url, seed: 7, parallel: 4 });

    assert.deepEqual(parallel.verdicts.map((v) => [v.id, v.verdict]), serial.verdicts.map((v) => [v.id, v.verdict]));
    assert.deepEqual(parallel.counts, serial.counts);
    // evidence file order: every case's events contiguous, cases in input order — as if serial
    const caseOrder = (events) => events.filter((e) => e.event === 'case-start' || e.event === 'case-verdict').map((e) => `${e.event}:${e.case ?? e.id}`);
    assert.deepEqual(caseOrder(parallel.events), caseOrder(serial.events));
  }));

test('bed.timeouts: the declared latency envelope overrides pinned ceilings', () =>
  withFixture(async ({ url }, bed) => {
    // a server that never answers: the request ceiling must fire (deterministically — a tiny
    // timeout racing a loopback response is a coin flip) → infra error, never fail
    const { createServer } = await import('node:http');
    const blackhole = createServer(() => { /* accept, never respond */ });
    await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
    const impatient = { ...bed, timeouts: { requestMs: 200 } };
    const t0 = performance.now();
    const v1 = await run(makeCase(), impatient, `http://127.0.0.1:${blackhole.address().port}`);
    blackhole.closeAllConnections();
    await new Promise((r) => blackhole.close(r));
    assert.equal(v1.verdict, 'error');
    assert.ok(performance.now() - t0 < 3000, 'must not wait out the pinned 5s default');

    // a 300ms pollUntil ceiling fails fast instead of the pinned 10s default
    const shortPoll = { ...bed, timeouts: { pollUntilMs: 300 } };
    const caseObj = makeCase({
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, capture: { requestId: 'body.id' } }],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
        pollUntil: { until: { body: { status: 'NEVER_A_STATE' } } },
      },
    });
    const started = performance.now();
    const v2 = await run(caseObj, shortPoll, url);
    assert.equal(v2.verdict, 'fail');
    assert.match(v2.reason, /300ms/);
    assert.ok(performance.now() - started < 5000, 'must not wait out the pinned 10s default');
  }));

test('runCases shard: disjoint deterministic slices whose union is the full run', () =>
  withFixture(async ({ url }, bed) => {
    const mk = (n) => makeCase({
      id: `CASE-s${n}`,
      test: { request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: 'nope' } }, expect: { status: 400 } },
    });
    const loaded = [1, 2, 3, 4, 5].map((n) => ({ file: `s${n}`, caseObj: mk(n) }));
    const full = await runCases(loaded, { bed, baseUrl: url, seed: 3 });
    const a = await runCases(loaded, { bed, baseUrl: url, seed: 3, shard: { index: 1, total: 2 } });
    const b = await runCases(loaded, { bed, baseUrl: url, seed: 3, shard: { index: 2, total: 2 } });
    const ids = (r) => r.verdicts.map((v) => v.id);
    assert.deepEqual(ids(a), ['CASE-s1', 'CASE-s3', 'CASE-s5']);
    assert.deepEqual(ids(b), ['CASE-s2', 'CASE-s4']);
    assert.deepEqual([...ids(a), ...ids(b)].sort(), ids(full).sort());
    const start = a.events.find((e) => e.event === 'run-start');
    assert.equal(start.shard, '1/2');
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
