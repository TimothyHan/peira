// RFC 0003 P3, amendment (G): {"$absent": true} — the one way subset matching can say "not here".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSubset, matchExpect } from '../dist/expect.js';
import { validateCase } from '../dist/validate.js';
import { renderCase } from '../dist/render.js';
import { makeCase } from './helpers.js';

test('body: an absent key passes, a present key fails — and null is a different claim', () => {
  assert.deepEqual(matchSubset({ users: { create: { $absent: true } } }, { users: { read: true } }), []);
  const present = matchSubset({ users: { create: { $absent: true } } }, { users: { create: false } });
  assert.equal(present.length, 1);
  assert.equal(present[0].path, 'body.users.create');
  assert.equal(present[0].reason, 'expected absent, but present');
  assert.equal(present[0].actual, false);
  // null asserts presence-with-null; $absent asserts no key
  assert.deepEqual(matchSubset({ k: null }, { k: null }), []);
  assert.equal(matchSubset({ k: { $absent: true } }, { k: null }).length, 1, 'a null-valued key is still present');
  assert.equal(matchSubset({ k: null }, {}).length, 1, 'null on a missing key is still "missing property"');
});

test('headers: a header that must not be set', () => {
  assert.deepEqual(matchExpect({ status: 200, headers: { 'x-frame-options': { $absent: true } } }, { status: 200, headers: { 'content-type': 'text/html' }, body: null }), []);
  const d = matchExpect({ headers: { 'X-Frame-Options': { $absent: true } } }, { status: 200, headers: { 'x-frame-options': 'DENY' }, body: null });
  assert.equal(d.length, 1);
  assert.equal(d[0].path, 'headers.x-frame-options');
});

test('the gate: standalone, exactly true, legal in body keys and header values, refused as the whole body', () => {
  const ok = makeCase({ test: { request: { method: 'get', route: '/access' }, expect: { status: 200, headers: { 'x-frame-options': { $absent: true } }, body: { users: { create: { $absent: true } } } } } });
  assert.deepEqual(validateCase(ok).errors, []);
  const bad = (body) => validateCase(makeCase({ test: { request: { method: 'get', route: '/x' }, expect: { status: 200, body } } })).errors;
  assert.match(bad({ k: { $absent: false } })[0], /takes exactly true/);
  assert.match(bad({ k: { $absent: true, extra: 1 } })[0], /must stand alone/);
  assert.match(bad({ $absent: true })[0], /not the whole body/);
});

test('render: $absent reads as <absent>, never as a JSON object', () => {
  const c = makeCase({ id: 'CASE-absent-render', test: { request: { method: 'get', route: '/access' }, expect: { status: 200, body: { users: { create: { $absent: true } } } } } });
  const md = renderCase(c);
  assert.match(md, /<absent>/);
  assert.ok(!md.includes('$absent'));
});
