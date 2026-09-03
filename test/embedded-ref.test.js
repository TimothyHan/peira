// RFC 0003 P4a: "$alias" inside a longer string is literal text. It used to be silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCase } from '../dist/validate.js';
import { makeCase } from './helpers.js';

const withRoute = (route) => makeCase({
  setup: [{ request: { method: 'post', route: '/news' }, capture: { theirs: 'body.id' } }],
  test: { request: { method: 'get', route }, expect: { status: 200, body: { id: { $any: 'string' } } } },
});

test('an embedded $alias in a route warns, naming the {{alias}} form; the whole-value form does not', () => {
  const { errors, warnings } = validateCase(withRoute('/api/news/$theirs'));
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /test\.request\.route: "\/api\/news\/\$theirs" contains \$theirs inside a longer string/);
  assert.match(warnings[0], /use \{\{theirs\}\}/);
  assert.deepEqual(validateCase(withRoute('/api/news/{{theirs}}')).warnings, []);
  assert.deepEqual(validateCase(makeCase({ test: { request: { method: 'get', route: '/x', query: { id: '$theirs' } }, expect: { status: 200, body: { a: 1 } } }, setup: [{ request: { method: 'post', route: '/n' }, capture: { theirs: 'body.id' } }] })).warnings, [], 'whole-value in query is the intended form');
});

test('bodies and query values are covered too; a lone "$" or "$5" is not a reference', () => {
  const c = makeCase({
    setup: [{ request: { method: 'post', route: '/n' }, capture: { theirs: 'body.id' } }],
    test: { request: { method: 'post', route: '/x', query: { q: 'ref $theirs' }, body: { note: 'see $theirs', price: 'costs $5', sym: '$' } }, expect: { status: 200, body: { a: 1 } } },
  });
  const { warnings } = validateCase(c);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /request\.query\.q/);
  assert.match(warnings[1], /request\.body\.note/);
});
