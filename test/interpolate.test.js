import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveValue, findTokens, UnresolvedTokenError } from '../src/interpolate.js';

const ctx = {
  captures: { requestId: 'abc-123', count: 7 },
  unique: (key) => `u-${key}`,
};

test('whole-value reference preserves type', () => {
  assert.equal(resolveValue('$count', ctx), 7);
  assert.equal(resolveValue('$requestId', ctx), 'abc-123');
  assert.equal(resolveValue('$unique.nonce', ctx), 'u-nonce');
});

test('in-string tokens resolve at any depth, inside strings', () => {
  const input = { a: [{ b: 'int x{{unique.n}} = 1; // {{requestId}}' }] };
  assert.deepEqual(resolveValue(input, ctx), { a: [{ b: 'int xu-n = 1; // abc-123' }] });
});

test('escape: {{{{ yields a literal {{', () => {
  assert.equal(resolveValue('{{{{not-a-token}}', ctx), '{{not-a-token}}');
});

test('unknown token throws UnresolvedTokenError', () => {
  assert.throws(() => resolveValue('$nope', ctx), UnresolvedTokenError);
  assert.throws(() => resolveValue('x {{nope}} y', ctx), UnresolvedTokenError);
});

test('$users.* is refused outside auth', () => {
  assert.throws(() => resolveValue('$users.user_1', ctx), UnresolvedTokenError);
});

test('non-reference values pass through untouched', () => {
  assert.deepEqual(resolveValue({ n: 5, b: true, z: null, s: 'plain $ text' }, ctx), { n: 5, b: true, z: null, s: 'plain $ text' });
});

test('findTokens enumerates without resolving', () => {
  const tokens = findTokens({ q: { id: '$requestId' }, body: { code: '1+1 /* {{unique.nonce}} */' } });
  assert.deepEqual(tokens, [
    { name: 'requestId', form: 'whole' },
    { name: 'unique.nonce', form: 'inline' },
  ]);
});
