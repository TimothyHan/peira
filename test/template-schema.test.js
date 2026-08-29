import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate } from '../src/validate.js';
import { makeBed, isolationTemplate } from './helpers.js';

const bedUsers = makeBed('http://x').users;

test('a well-formed template passes', () => {
  assert.deepEqual(validateTemplate(isolationTemplate(), { bedUsers }).errors, []);
});

test('unknown hole kind, unknown hole reference, and bad distinctFrom are refused', () => {
  const badKind = isolationTemplate({ holes: { x: { kind: 'uuid' } }, test: { request: { method: 'get', route: '/x' }, expect: { status: 200 } } });
  delete badKind.setup;
  assert.ok(validateTemplate(badKind).errors.some((e) => /kind must be one of/.test(e)));

  const unknownRef = isolationTemplate();
  unknownRef.test.request.auth = '$holes.ghost';
  assert.ok(validateTemplate(unknownRef, { bedUsers }).errors.length > 0);

  const forwardDistinct = isolationTemplate({
    holes: { other: { kind: 'principal', distinctFrom: 'submitter' }, submitter: { kind: 'principal' }, script: { kind: 'expression' } },
  });
  assert.ok(validateTemplate(forwardDistinct, { bedUsers }).errors.some((e) => /earlier-declared/.test(e)));

  const distinctOnExpr = isolationTemplate();
  distinctOnExpr.holes.script = { kind: 'expression', distinctFrom: 'submitter' };
  assert.ok(validateTemplate(distinctOnExpr, { bedUsers }).errors.some((e) => /applies only to principal/.test(e)));
});

test('expression holes must be referenced by attribute; principals must not be', () => {
  const bareExpr = isolationTemplate();
  bareExpr.setup[0].request.body.code = '$holes.script';
  assert.ok(validateTemplate(bareExpr, { bedUsers }).errors.some((e) => /referenced by attribute/.test(e)));

  const principalAttr = isolationTemplate();
  principalAttr.setup[0].request.body.code = '{{holes.submitter.name}}';
  assert.ok(validateTemplate(principalAttr, { bedUsers }).errors.some((e) => /has no attribute/.test(e)));
});

test('a distinct-group larger than the principal pool is refused', () => {
  const tpl = isolationTemplate();
  tpl.holes.third = { kind: 'principal', distinctFrom: 'other' };
  // pool of 2 cannot satisfy a chain… conservatively refused as a 3-member group
  const onePrincipal = { user_1: bedUsers.user_1 };
  assert.ok(validateTemplate(isolationTemplate(), { bedUsers: onePrincipal }).errors.some((e) => /distinct-group/.test(e)));
});

test('hole references are refused in plain cases', async () => {
  const { validateCase } = await import('../src/validate.js');
  const { makeCase } = await import('./helpers.js');
  const c = makeCase({ test: { request: { method: 'get', route: '/x', query: { q: '$holes.a' } }, expect: { status: 200 } } });
  assert.ok(validateCase(c).errors.some((e) => /only valid in templates/.test(e)));
});

test('a template id must be TPL-, holes are required', () => {
  assert.ok(validateTemplate(isolationTemplate({ id: 'CASE-x-001' })).errors.length > 0);
  const noHoles = isolationTemplate();
  delete noHoles.holes;
  assert.ok(validateTemplate(noHoles).errors.some((e) => /holes/.test(e)));
});
