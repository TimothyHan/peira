// The fixture honors its own semantics — so a red corpus case indicts the case, not the bed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpRequest } from '../src/http.js';
import { withFixture } from './helpers.js';
import { POLL_INTERVAL_MS } from '../src/constants.js';

const alice = { username: 'user_1', password: 'pass_1' };
const bob = { username: 'user_2', password: 'pass_2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submitCode(baseUrl, code, auth = alice) {
  return httpRequest({ baseUrl, method: 'post', route: '/groovy/submit', auth, body: { code } });
}
async function status(baseUrl, id, auth = alice) {
  return httpRequest({ baseUrl, method: 'get', route: '/groovy/status', query: { id }, auth });
}
async function pollTerminal(baseUrl, id, auth = alice) {
  for (let i = 0; i < 100; i++) {
    const res = await status(baseUrl, id, auth);
    if (['COMPLETED', 'FAILED'].includes(res.body.status)) return res.body;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('job never reached a terminal state');
}

test('auth: invalid, empty, and wrong-password credentials get the 401 envelope', () =>
  withFixture(async ({ url }) => {
    for (const auth of [{ username: 'invalid', password: 'cred' }, { username: '', password: '' }, { username: 'user_1', password: '' }]) {
      const res = await submitCode(url, '1+1', auth);
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
      assert.equal(res.body.message, '');
      assert.equal(typeof res.body.timestamp, 'string');
    }
  }));

test('submit: payload must be exactly {code: string}; validation errors carry an empty message', () =>
  withFixture(async ({ url }) => {
    for (const body of [{}, { code: '1+1', garbage: 'x' }, { code: 123 }]) {
      const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body });
      assert.equal(res.status, 400);
      assert.equal(res.body.message, '');
      assert.equal(res.body.path, '/groovy/submit');
    }
  }));

test('submit: a syntax error is 400 with a real message', () =>
  withFixture(async ({ url }) => {
    const res = await submitCode(url, 'def wrongFunc(a { a }');
    assert.equal(res.status, 400);
    assert.ok(res.body.message.length > 0);
  }));

test('lifecycle: arithmetic completes with a string result; unknown calls fail with a message', () =>
  withFixture(async ({ url }) => {
    const okJob = await submitCode(url, '1+1');
    assert.equal(okJob.status, 200);
    const done = await pollTerminal(url, okJob.body.id);
    assert.deepEqual({ status: done.status, result: done.result }, { status: 'COMPLETED', result: '2' });

    const badJob = await submitCode(url, 'somethingWrong() - 2');
    const failed = await pollTerminal(url, badJob.body.id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(typeof failed.result, 'string');
  }));

test('comments are stripped before evaluation (unique-nonce embedding keeps results stable)', () =>
  withFixture(async ({ url }) => {
    const block = await submitCode(url, '1+1 /* u123abc */');
    assert.equal((await pollTerminal(url, block.body.id)).result, '2');
    const line = await submitCode(url, '1 + 1 // u456def');
    assert.equal((await pollTerminal(url, line.body.id)).result, '2');
  }));

test('groovy parity beyond the 2022 corpus: string-literal returns and typed method declarations', () =>
  withFixture(async ({ url }) => {
    const ret = await submitCode(url, "sleep(1); return 'done u789'");
    assert.deepEqual((await pollTerminal(url, ret.body.id)).result, 'done u789');
    const typed = await submitCode(url, "class Greeter { String name\n  String greet() { return 'hi ' + name } }\ndef g = new Greeter(name: 'x')\nreturn g.greet()");
    assert.equal((await pollTerminal(url, typed.body.id)).status, 'COMPLETED');
    const divZero = await submitCode(url, 'def z = 0\nreturn 1 / z');
    const failed = await pollTerminal(url, divZero.body.id);
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.result, /Division by zero/);
  }));

test('capacity 2: two long jobs run, the third stays PENDING, then completes after promotion', () =>
  withFixture(async ({ url }) => {
    const [a, b, c] = [await submitCode(url, 'sleep(1000)'), await submitCode(url, 'sleep(999)'), await submitCode(url, '4+5')];
    assert.equal((await status(url, a.body.id)).body.status, 'IN_PROGRESS');
    assert.equal((await status(url, b.body.id)).body.status, 'IN_PROGRESS');
    assert.equal((await status(url, c.body.id)).body.status, 'PENDING');
    const third = await pollTerminal(url, c.body.id);
    assert.deepEqual({ status: third.status, result: third.result }, { status: 'COMPLETED', result: '9' });
  }));

test('isolation: another user fetching my job gets 401, not 403 — the 2022 observed behavior', () =>
  withFixture(async ({ url }) => {
    const job = await submitCode(url, '1+1', alice);
    const res = await status(url, job.body.id, bob);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
  }));

test('status ids: missing/empty/malformed → 400, well-formed-but-unknown → 404', () =>
  withFixture(async ({ url }) => {
    assert.equal((await httpRequest({ baseUrl: url, method: 'get', route: '/groovy/status', auth: alice })).status, 400);
    assert.equal((await status(url, '')).status, 400);
    assert.equal((await status(url, 'invalidRequestID')).status, 400);
    assert.equal((await status(url, '00000000-aaaa-1111-bbbb-222222222222')).status, 404);
  }));

test('reset clears all jobs', () =>
  withFixture(async ({ url, reset }) => {
    const job = await submitCode(url, '1+1');
    reset();
    assert.equal((await status(url, job.body.id)).status, 404);
  }));
