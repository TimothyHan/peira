import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSubset, matchExpect } from '../dist/expect.js';

test('object subset at every level (toMatchObject parity)', () => {
  assert.deepEqual(matchSubset({ a: 1 }, { a: 1, extra: 'ignored' }), []);
  assert.deepEqual(matchSubset({ a: { b: 2 } }, { a: { b: 2, c: 3 } }), []);
  const diffs = matchSubset({ a: { b: 9 } }, { a: { b: 2 } });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'body.a.b');
});

test('missing property is a named diff', () => {
  const diffs = matchSubset({ a: 1 }, {});
  assert.equal(diffs[0].reason, 'missing property');
  assert.equal(diffs[0].path, 'body.a');
});

test('arrays: equal length, index-wise, subset objects inside (toMatchObject parity)', () => {
  assert.deepEqual(matchSubset([{ a: 1 }], [{ a: 1, b: 2 }]), []);
  assert.equal(matchSubset([1, 2], [1, 2, 3]).length, 1); // length mismatch
  assert.equal(matchSubset([1, 2], [2, 1]).length, 2); // index-wise
});

test('$any matchers: closed type vocabulary', () => {
  assert.deepEqual(matchSubset({ id: { $any: 'string' } }, { id: 'x' }), []);
  assert.deepEqual(matchSubset({ n: { $any: 'number' } }, { n: 1.5 }), []);
  assert.deepEqual(matchSubset({ b: { $any: 'boolean' } }, { b: false }), []);
  assert.equal(matchSubset({ id: { $any: 'string' } }, { id: 7 }).length, 1);
  assert.equal(matchSubset({ id: { $any: 'string' } }, { id: null }).length, 1);
});

test('literal null asserts present-and-null', () => {
  assert.deepEqual(matchSubset({ result: null }, { result: null }), []);
  assert.equal(matchSubset({ result: null }, { result: 'x' }).length, 1);
  assert.equal(matchSubset({ result: null }, {}).length, 1);
});

test('primitives match strictly — no coercion', () => {
  assert.equal(matchSubset('2', 2).length, 1);
  assert.equal(matchSubset(0, false).length, 1);
});

test('matchExpect: status, body, bodySchema', () => {
  const response = { status: 200, body: { id: 'x', n: 3 } };
  assert.deepEqual(matchExpect({ status: 200, body: { id: 'x' } }, response), []);
  assert.equal(matchExpect({ status: 404 }, response)[0].path, 'status');
  const schemaDiffs = matchExpect({ bodySchema: { type: 'object', required: ['missing'] } }, response);
  assert.equal(schemaDiffs.length, 1);
});

test('$contains matcher: string containing the substring', () => {
  assert.deepEqual(matchSubset({ msg: { $contains: 'zero' } }, { msg: 'Division by zero!' }), []);
  assert.equal(matchSubset({ msg: { $contains: 'zero' } }, { msg: 'fine' }).length, 1);
  assert.equal(matchSubset({ msg: { $contains: 'zero' } }, { msg: 42 }).length, 1); // non-string never contains
  const diff = matchSubset({ $contains: 'x' }, null, 'headers.location')[0];
  assert.equal(diff.path, 'headers.location');
  assert.match(diff.reason, /containing/);
});

test('matchExpect headers: case-insensitive names, subset semantics, matchers', () => {
  const response = {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8', location: '/orders/42' },
    body: null,
  };
  assert.deepEqual(matchExpect({ headers: { 'Content-Type': { $contains: 'application/json' } } }, response), []);
  assert.deepEqual(matchExpect({ status: 201, headers: { Location: '/orders/42' } }, response), []);
  assert.deepEqual(matchExpect({ headers: { location: { $any: 'string' } } }, response), []);

  const wrong = matchExpect({ headers: { location: '/orders/43' } }, response);
  assert.equal(wrong[0].path, 'headers.location');
  assert.equal(wrong[0].reason, 'value mismatch');
});

test('matchExpect headers: a missing header is a named diff', () => {
  const response = { status: 200, headers: { 'content-type': 'application/json' }, body: null };
  const diffs = matchExpect({ headers: { 'X-Rate-Limit': { $any: 'string' } } }, response);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'headers.x-rate-limit');
  assert.equal(diffs[0].reason, 'missing header');
  // a response with no headers at all behaves the same, not a crash
  assert.equal(matchExpect({ headers: { etag: 'x' } }, { status: 200, body: null }).length, 1);
});
