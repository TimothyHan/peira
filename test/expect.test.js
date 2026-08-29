import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSubset, matchExpect } from '../src/expect.js';

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
