// RFC 0002 acceptance criteria, in order: token principals log in once (serial and parallel),
// tokens attach as declared, a failed login is an error not a fail, secrets never reach the
// evidence log, a literal token is refused by the service, redirects are assertable on request,
// and Basic beds behave exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCases, runCase } from '../dist/runner.js';
import { EvidenceLog, SecretRegistry, deepRedact } from '../dist/evidence.js';
import { validateBed, validatePrincipal } from '../dist/validate-bed.js';
import { validateCase } from '../dist/validate.js';
import { withFixture, makeCase, makeBed, verdictMeaning } from './helpers.js';

const STATIC_TOKEN = 'fixture-static-token-0001';

/** The fixture bed plus one principal of every RFC 0002 shape. */
function tokenBed(baseUrl) {
  const bed = makeBed(baseUrl);
  bed.users.staff = {
    login: { route: '/login', body: { username: 'user_1', password: 'pass_1' }, token: 'body.token', send: { header: 'Authorization', format: 'Bearer {{token}}' } },
  };
  bed.users.jwt = {
    login: { method: 'post', route: '/login', body: { username: 'user_2', password: 'pass_2' }, token: 'body.token', send: { header: 'Authorization', format: 'JWT {{token}}' } },
  };
  bed.users.cook = {
    login: { route: '/login', body: { username: 'user_1', password: 'pass_1' }, token: 'body.token', send: { cookie: 'session' } },
  };
  bed.users.svc = { token: STATIC_TOKEN, send: { header: 'X-API-Key', format: '{{token}}' } };
  bed.users.broken = {
    login: { route: '/login', body: { username: 'user_1', password: 'wrong' }, token: 'body.token', send: { header: 'Authorization', format: 'Bearer {{token}}' } },
  };
  bed.users.notoken = {
    login: { route: '/login', body: { username: 'user_1', password: 'pass_1' }, token: 'body.nope', send: { header: 'Authorization', format: 'Bearer {{token}}' } },
  };
  return bed;
}

const whoami = (id, auth, expectBody) =>
  makeCase({ id, test: { request: { method: 'get', route: '/whoami', auth }, expect: { status: 200, body: expectBody } } });

const load = (...cases) => cases.map((caseObj) => ({ file: caseObj.id, caseObj }));

// --- AC: token principals log in once ------------------------------------------------------

test('login once: three cases under one login principal → exactly one login event, serial', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [1, 2, 3].map((n) => whoami(`CASE-staff-${n}`, '$users.staff', { user: 'user_1' }));
    const { counts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(counts, { pass: 3, fail: 0, error: 0 });
    const logins = events.filter((e) => e.event === 'login');
    assert.equal(logins.length, 1);
    assert.equal(logins[0].principal, 'staff');
    assert.equal(logins[0].outcome, 'ok');
    assert.equal(logins[0].redaction, 'registered');
    // the login event sits just before run-end: same shape serial or parallel
    assert.equal(events.at(-2).event, 'login');
    assert.equal(events.at(-1).event, 'run-end');
  }));

test('login once: --parallel 3 racing on an uncached principal still logs in exactly once', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [1, 2, 3].map((n) => whoami(`CASE-par-${n}`, '$users.staff', { user: 'user_1' }));
    const { counts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1, parallel: 3 });
    assert.deepEqual(counts, { pass: 3, fail: 0, error: 0 });
    assert.equal(events.filter((e) => e.event === 'login').length, 1);
  }));

test('login events flush in alias order regardless of first-use order', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [whoami('CASE-a', '$users.jwt', { user: 'user_2' }), whoami('CASE-b', '$users.cook', { user: 'user_1' }), whoami('CASE-c', '$users.staff', { user: 'user_1' })];
    const { events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(events.filter((e) => e.event === 'login').map((e) => e.principal), ['cook', 'jwt', 'staff']);
  }));

// --- AC: token is attached as declared -----------------------------------------------------

test('attachment: header, JWT format, cookie, and static api key all reach the service as that user — never Basic', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [
      whoami('CASE-staff', '$users.staff', { user: 'user_1' }),
      whoami('CASE-jwt', '$users.jwt', { user: 'user_2' }),
      whoami('CASE-cook', '$users.cook', { user: 'user_1' }),
      whoami('CASE-svc', '$users.svc', { user: 'user_1' }),
    ];
    const { verdicts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(verdictMeaning(verdicts), cases.map((c) => ({ id: c.id, verdict: 'pass' })));
    const sent = Object.fromEntries(events.filter((e) => e.event === 'http').map((e) => [e.case, e.request.headers]));
    assert.ok('authorization' in sent['CASE-staff'] && !('cookie' in sent['CASE-staff']));
    assert.ok('authorization' in sent['CASE-jwt']);
    assert.ok('cookie' in sent['CASE-cook'] && !('authorization' in sent['CASE-cook']));
    assert.ok('x-api-key' in sent['CASE-svc'] && !('authorization' in sent['CASE-svc']));
    for (const headers of Object.values(sent)) {
      for (const value of Object.values(headers)) assert.ok(!String(value).startsWith('Basic '), 'no token principal falls back to Basic');
    }
  }));

test('drain re-attaches the token: a captured job under a login principal drains under it', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const caseObj = makeCase({
      id: 'CASE-drain-token',
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.staff', body: { code: '1 + 1' } }, capture: { requestId: 'body.id' } }],
      test: { request: { method: 'get', route: '/groovy/status', auth: '$users.staff', query: { id: '$requestId' } }, expect: { status: 200 } },
      teardown: { drain: true },
    });
    const { counts, events } = await runCases(load(caseObj), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(counts, { pass: 1, fail: 0, error: 0 });
    assert.ok(events.some((e) => e.event === 'drain-complete' && e.drained.includes('requestId')));
    assert.equal(events.filter((e) => e.event === 'login').length, 1, 'drain used the cached token, not a second login');
  }));

// --- AC: failed login is an error, not a fail ----------------------------------------------

test('a refused login → every case on that principal is error, naming principal and status', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [1, 2].map((n) => whoami(`CASE-broken-${n}`, '$users.broken', { user: 'user_1' }));
    const { verdicts, counts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(counts, { pass: 0, fail: 0, error: 2 });
    for (const v of verdicts) {
      assert.equal(v.verdict, 'error');
      assert.match(v.reason, /\$users\.broken/);
      assert.match(v.reason, /401/);
    }
    const login = events.find((e) => e.event === 'login' && e.principal === 'broken');
    assert.equal(login.outcome, 'refused');
    assert.equal(login.status, 401);
  }));

test('a login whose token path is absent → error naming the path', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const { verdicts } = await runCases(load(whoami('CASE-notoken', '$users.notoken', { user: 'user_1' })), { bed, baseUrl: url, seed: 1 });
    assert.equal(verdicts[0].verdict, 'error');
    assert.match(verdicts[0].reason, /body\.nope/);
  }));

// --- AC: secrets never reach the evidence log ----------------------------------------------

test('no token, no password, anywhere in the JSONL — headers, login bodies, echoed response bodies, custom headers', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const evidencePath = join(mkdtempSync(join(tmpdir(), 'peira-')), 'evidence.jsonl');
    const cases = [
      whoami('CASE-staff', '$users.staff', { user: 'user_1' }),
      whoami('CASE-svc', '$users.svc', { user: 'user_1' }),
      whoami('CASE-cook', '$users.cook', { user: 'user_1' }),
    ];
    const { counts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1, evidencePath });
    assert.deepEqual(counts, { pass: 3, fail: 0, error: 0 });

    // learn the real session token independently, then prove it is nowhere in the file
    const res = await fetch(`${url}/login`, { method: 'POST', body: JSON.stringify({ username: 'user_1', password: 'pass_1' }), headers: { 'content-type': 'application/json' } });
    const { token: freshToken } = await res.json();
    assert.match(freshToken, /^tok_[0-9a-f]{32}$/);

    const text = readFileSync(evidencePath, 'utf8');
    assert.ok(!text.includes('pass_1'), 'login password never lands');
    assert.ok(!text.includes(STATIC_TOKEN), 'the static api key is scrubbed from the custom header AND the echo body');
    assert.ok(!/tok_[0-9a-f]{32}/.test(text), 'no session token in plaintext anywhere');
    assert.ok(!text.includes('Basic '), 'nothing Basic in a token run');

    // the echo route returned the token in two body fields: `token` (key-redacted) and a prose
    // string (value-scrubbed) — both carry the tag, and the tag is stable across events
    const svc = events.find((e) => e.event === 'http' && e.case === 'CASE-svc');
    assert.match(svc.response.body.token, /^\[REDACTED:[0-9a-f]{8}\]$/);
    assert.match(svc.response.body.echoed, /^seen \[REDACTED:[0-9a-f]{8}\] here$/);
    assert.equal(svc.request.headers['x-api-key'], svc.response.body.token, 'same secret, same tag, across header and body');
  }));

test('deepRedact: password and token keys, and registered values inside any string', () => {
  const secrets = new SecretRegistry();
  assert.equal(secrets.register('short'), false, 'too short to scrub safely');
  assert.equal(secrets.register('a-long-enough-secret-value'), true);
  const out = deepRedact({ password: 'pw', token: 'x', nested: { note: 'the a-long-enough-secret-value leaked' }, list: ['a-long-enough-secret-value'] }, secrets);
  assert.match(out.password, /^\[REDACTED:/);
  assert.match(out.token, /^\[REDACTED:/);
  assert.match(out.nested.note, /^the \[REDACTED:[0-9a-f]{8}\] leaked$/);
  assert.match(out.list[0], /^\[REDACTED:/);
});

// --- AC: an invalid token is refused (amendment F) -----------------------------------------

test('a literal {"token"} defaults to Bearer and is refused with 401; with send it targets cookie or header', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const bad = (id, auth) => makeCase({ id, test: { request: { method: 'get', route: '/whoami', auth }, expect: { status: 401 } } });
    const cases = [
      bad('CASE-bad-bearer', { token: 'not-a-real-token-000' }),
      bad('CASE-bad-cookie', { token: 'not-a-real-token-000', send: { cookie: 'session' } }),
      bad('CASE-bad-key', { token: 'not-a-real-token-000', send: { header: 'X-API-Key', format: '{{token}}' } }),
    ];
    for (const c of cases) assert.deepEqual(validateCase(c, { bedUsers: bed.users }).errors, [], `${c.id} passes the schema gate`);
    const { counts, events } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(counts, { pass: 3, fail: 0, error: 0 });
    assert.ok(!JSON.stringify(events).includes('not-a-real-token-000'), 'the literal token is a secret too');
    // and a real static token via the literal form is accepted — proving the negative is about the value
    const good = makeCase({ id: 'CASE-literal-good', test: { request: { method: 'get', route: '/whoami', auth: { token: STATIC_TOKEN, send: { header: 'X-API-Key', format: '{{token}}' } } }, expect: { status: 200, body: { user: 'user_1' } } } });
    const r = await runCases(load(good), { bed, baseUrl: url, seed: 1 });
    assert.equal(r.counts.pass, 1);
  }));

// --- AC: redirects are assertable when asked (amendment E) ---------------------------------

test('followRedirects: false sees the 307 and its location; the default follows to the target', () =>
  withFixture(async ({ url }) => {
    const bed = tokenBed(url);
    const cases = [
      makeCase({ id: 'CASE-redirect-seen', test: { request: { method: 'get', route: '/redirect', auth: '$users.staff', followRedirects: false }, expect: { status: 307, headers: { location: { $contains: '/login?next=' } } } } }),
      makeCase({ id: 'CASE-redirect-followed', test: { request: { method: 'get', route: '/redirect', auth: '$users.staff' }, expect: { status: 200, body: { page: 'login' } } } }),
      makeCase({ id: 'CASE-redirect-capture', test: { request: { method: 'get', route: '/redirect', auth: '$users.staff', followRedirects: false }, capture: { next: 'headers.location' }, expect: { status: 307 } } }),
    ];
    for (const c of cases) assert.deepEqual(validateCase(c, { bedUsers: bed.users }).errors, []);
    const { verdicts } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(verdictMeaning(verdicts), cases.map((c) => ({ id: c.id, verdict: 'pass' })));
  }));

// --- AC: beds without login behave exactly as before ---------------------------------------

test('backcompat: a Basic-only bed produces the same verdicts and no login event', () =>
  withFixture(async ({ url }, bed) => {
    const caseObj = makeCase({ id: 'CASE-basic', test: { request: { method: 'get', route: '/whoami', auth: '$users.user_1' }, expect: { status: 200, body: { user: 'user_1' } } } });
    const { counts, events } = await runCases(load(caseObj), { bed, baseUrl: url, seed: 1 });
    assert.deepEqual(counts, { pass: 1, fail: 0, error: 0 });
    assert.equal(events.filter((e) => e.event === 'login').length, 0);
    assert.deepEqual(events.map((e) => e.event), ['run-start', 'case-start', 'http', 'case-verdict', 'run-end']);
    // a standalone runCase (no shared store) still works and still flushes nothing
    const v = await runCase(caseObj, { bed, baseUrl: url, seed: 1, evidence: new EvidenceLog(null) });
    assert.equal(v.verdict, 'pass');
  }));

// --- the bed gate (RFC 0002 §3.6) -------------------------------------------------------------

test('validateBed: every RFC 0002 shape is admitted; the fixture bed is unchanged', () =>
  withFixture(async ({ url }, basicBed) => {
    assert.deepEqual(validateBed(basicBed), []);
    assert.deepEqual(validateBed(tokenBed(url)), []);
    assert.deepEqual(validateBed({ baseUrl: url, $comment: 'peira init writes this', users: {} }), [], 'top level stays permissive');
  }));

test('validateBed: the static checks a schema cannot express', () => {
  const login = (over) => validatePrincipal('p', { login: { route: '/login', token: 'body.token', send: { header: 'Authorization', format: 'Bearer {{token}}' }, ...over } });
  assert.match(validatePrincipal('p', { username: 'u', password: 'p', token: 'x', send: { cookie: 'c' } })[0], /exactly one of/);
  assert.match(validatePrincipal('p', {})[0], /none of them/);
  assert.match(validatePrincipal('p', { username: 'u' })[0], /password must be a string/);
  assert.match(login({ route: 'login' })[0], /starting with \//);
  assert.match(login({ token: 'nope' })[0], /capture path/);
  assert.match(login({ send: { header: 'X', format: 'no placeholder' } })[0], /must contain \{\{token\}\}/);
  assert.match(login({ send: { header: 'X', format: '{{token}}', cookie: 'c' } })[0], /exactly one of/);
  assert.match(login({ send: {} })[0], /exactly one of/);
  assert.match(login({ body: { nonce: '{{unique.nonce}}' } })[0], /may not reference unique/);
  assert.match(login({ method: 'fetch' })[0], /method must be one of/);
  assert.match(validatePrincipal('p', { token: 'k' })[0], /needs "send"/);
  assert.match(validatePrincipal('p', { token: 'k', send: { cookie: 'c' }, extra: 1 })[0], /unknown key "extra"/);
  assert.deepEqual(login({}), []);
  assert.deepEqual(validatePrincipal('p', { token: 'k', send: { cookie: 'c' } }), []);
});

test('the case gate: an auth object that is neither Basic nor token is still refused', () => {
  const { errors } = validateCase(makeCase({ test: { request: { method: 'get', route: '/x', auth: { username: 'only' } }, expect: { status: 200 } } }));
  assert.ok(errors.length > 0);
  const bad = validateCase(makeCase({ test: { request: { method: 'get', route: '/x', auth: { token: 't', send: { header: 'X' } } }, expect: { status: 200 } } }));
  assert.ok(bad.errors.length > 0, 'send without format is refused by the schema');
});
