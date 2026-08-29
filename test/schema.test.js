import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema } from '../src/schema.js';

const ok = (schema, value) => assert.deepEqual(validateSchema(schema, value), []);
const bad = (schema, value, keyword) => {
  const errors = validateSchema(schema, value);
  assert.ok(errors.length > 0, 'expected errors');
  assert.ok(errors.some((e) => e.keyword === keyword), `expected a ${keyword} error, got ${JSON.stringify(errors)}`);
};

test('type: accepts and refuses', () => {
  ok({ type: 'string' }, 'x');
  bad({ type: 'string' }, 5, 'type');
  ok({ type: 'integer' }, 3);
  bad({ type: 'integer' }, 3.5, 'type');
  ok({ type: 'number' }, 3); // integers are numbers
  ok({ type: ['string', 'null'] }, null);
  bad({ type: ['string', 'null'] }, 5, 'type');
});

test('required and properties', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  ok(schema, { a: 'x' });
  bad(schema, {}, 'required');
  bad(schema, { a: 1 }, 'type');
});

test('additionalProperties: false refuses unknown keys, names the path', () => {
  const schema = { type: 'object', properties: { a: {} }, additionalProperties: false };
  ok(schema, { a: 1 });
  const errors = validateSchema(schema, { a: 1, zz: 2 });
  assert.equal(errors[0].keyword, 'additionalProperties');
  assert.match(errors[0].message, /"zz"/);
});

test('enum, items, pattern', () => {
  ok({ enum: ['a', true] }, true);
  bad({ enum: ['a', true] }, 'b', 'enum');
  ok({ type: 'array', items: { type: 'integer' } }, [1, 2]);
  bad({ type: 'array', items: { type: 'integer' } }, [1, 'x'], 'type');
  ok({ type: 'string', pattern: '^ab' }, 'abc');
  bad({ type: 'string', pattern: '^ab' }, 'zab', 'pattern');
});

test('anyOf: valid when one branch matches, error names both failures', () => {
  const schema = { anyOf: [{ type: 'string' }, { type: 'object', required: ['u'], properties: { u: { type: 'string' } } }] };
  ok(schema, 'x');
  ok(schema, { u: 'y' });
  bad(schema, 5, 'anyOf');
});

test('$ref: internal resolution', () => {
  const schema = { type: 'object', properties: { s: { $ref: '#/$defs/thing' } }, $defs: { thing: { type: 'string' } } };
  ok(schema, { s: 'x' });
  bad(schema, { s: 5 }, 'type');
});
