// RFC 0004 amendments (H) and (I): $contains takes a list (all of); $notContains says "must not leak".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSubset, matchExpect } from '../dist/expect.js';
import { validateCase } from '../dist/validate.js';
import { renderCase } from '../dist/render.js';
import { makeCase } from './helpers.js';

const html = '<h1>보안 교육 이수 요청</h1><a href="/admin/collections/announcements/create">write</a>';

test('$contains list: all-of, one diff per missing substring; a single string still works', () => {
  assert.deepEqual(matchSubset({ $contains: ['보안 교육', 'announcements/create'] }, html), []);
  const d = matchSubset({ $contains: ['보안 교육', 'delete', 'nope'] }, html);
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((x) => x.expected), ['<contains "delete">', '<contains "nope">']);
  assert.deepEqual(matchSubset({ $contains: 'write' }, html), []);
  assert.equal(matchSubset({ $contains: ['a'] }, 42).length, 1, 'a non-string never contains');
});

test('$notContains: passes when nothing leaks, names each substring that does', () => {
  assert.deepEqual(matchSubset({ $notContains: 'evil.example' }, '/hub/kjasset/'), []);
  const d = matchSubset({ $notContains: ['evil.example', 'kjasset'] }, 'https://evil.example/?back=/hub/kjasset');
  assert.equal(d.length, 2);
  assert.match(d[0].reason, /not containing "evil\.example", but it does/);
  assert.deepEqual(matchSubset({ $notContains: 'x' }, 42), [], 'a non-string cannot leak a substring');
});

test('the open-redirect guard, as a header assertion', () => {
  const ok = { status: 307, headers: { location: '/hub/kjasset/?next=%2Fhub' }, body: '' };
  const leak = { status: 307, headers: { location: 'https://evil.example/?back=/hub/kjasset' }, body: '' };
  const expect = { status: 307, headers: { location: { $contains: '/hub/kjasset' } } };
  assert.deepEqual(matchExpect(expect, ok), []);
  assert.deepEqual(matchExpect(expect, leak), [], 'the positive form is fooled — this was the report');
  const guarded = { status: 307, headers: { location: { $notContains: 'evil.example' } } };
  assert.deepEqual(matchExpect(guarded, ok), []);
  assert.equal(matchExpect(guarded, leak).length, 1);
});

test('the gate: strings or non-empty string lists, standalone; legal in headers', () => {
  const c = (body) => validateCase(makeCase({ test: { request: { method: 'get', route: '/x' }, expect: { status: 200, body } } })).errors;
  assert.deepEqual(c({ msg: { $contains: ['a', 'b'] } }), []);
  assert.deepEqual(c({ msg: { $notContains: ['a'] } }), []);
  assert.match(c({ msg: { $contains: [] } })[0], /non-empty array/);
  assert.match(c({ msg: { $contains: [1] } })[0], /non-empty array of strings/);
  assert.match(c({ msg: { $notContains: 3 } })[0], /string or a non-empty array/);
  assert.match(c({ msg: { $notContains: 'a', extra: 1 } })[0], /must stand alone/);
  const h = validateCase(makeCase({ test: { request: { method: 'get', route: '/x' }, expect: { status: 307, headers: { location: { $notContains: 'evil' } } } } })).errors;
  assert.deepEqual(h, []);
});

test('render: both read as words', () => {
  const c = makeCase({ id: 'CASE-nc', test: { request: { method: 'get', route: '/x' }, expect: { status: 200, body: { a: { $notContains: 'evil' }, b: { $contains: ['x', 'y'] } } } } });
  const md = renderCase(c);
  // the renderer JSON-stringifies the expected map, so the tokens' quotes arrive escaped
  assert.ok(md.includes('<not contains \\"evil\\">'), md);
  assert.ok(md.includes('<contains [\\"x\\",\\"y\\"]>'), md);
  assert.ok(!md.includes('$notContains') && !md.includes('$contains'), 'matcher keys never render raw');
});
