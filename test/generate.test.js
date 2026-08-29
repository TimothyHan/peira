import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prng, drawHoles, mintCase, mintAll } from '../dist/generate.js';
import { isolationTemplate } from './helpers.js';
import { makeBed } from './helpers.js';

const bedUsers = makeBed('http://x').users;

test('prng: same material → same stream; different material → different stream', () => {
  const a1 = prng('42|TPL-x|0');
  const a2 = prng('42|TPL-x|0');
  const b = prng('42|TPL-x|1');
  const seqA1 = [a1(), a1(), a1()];
  const seqA2 = [a2(), a2(), a2()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA1, seqA2);
  assert.notDeepEqual(seqA1, seqB);
});

test('draws are pure in (seed, template, index); distinctFrom is honored on a 2-principal pool', () => {
  for (let index = 0; index < 20; index++) {
    const v1 = drawHoles(isolationTemplate(), { bedUsers, seed: 42, index });
    const v2 = drawHoles(isolationTemplate(), { bedUsers, seed: 42, index });
    assert.deepEqual(v1, v2);
    assert.notEqual(v1.submitter.ref, v1.other.ref, `index ${index}: distinct principals`);
  }
  const different = drawHoles(isolationTemplate(), { bedUsers, seed: 43, index: 0 });
  const base = drawHoles(isolationTemplate(), { bedUsers, seed: 42, index: 0 });
  assert.notDeepEqual(different, base);
});

test("the expression generator's result is actually the value of its code", () => {
  for (let index = 0; index < 30; index++) {
    const { script } = drawHoles(isolationTemplate(), { bedUsers, seed: 7, index });
    const value = Function(`"use strict"; return (${script.code});`)();
    assert.equal(script.result, String(value), script.code);
  }
});

test('mintCase resolves holes everywhere and stamps identity + provenance', () => {
  const caseObj = mintCase(isolationTemplate(), { bedUsers, seed: 42, index: 3 });
  assert.equal(caseObj.id, 'CASE-result-isolation-001-g3');
  assert.deepEqual(caseObj.from, { intent: 'result-isolation', hash: 'abcdef123456', template: 'TPL-result-isolation-001', seed: 42, instance: 3 });
  assert.match(caseObj.setup[0].request.auth, /^\$users\.user_[12]$/);
  assert.match(caseObj.test.request.auth, /^\$users\.user_[12]$/);
  assert.notEqual(caseObj.setup[0].request.auth, caseObj.test.request.auth);
  assert.match(caseObj.setup[0].request.body.code, /^\d+ [+\-*] \d+$/);
  assert.ok(!('holes' in caseObj));
  assert.ok(!JSON.stringify(caseObj).includes('holes.'), 'no unresolved hole references');
});

test('a minted case validates as a plain case', async () => {
  const { validateCase } = await import('../dist/validate.js');
  const caseObj = mintCase(isolationTemplate(), { bedUsers, seed: 42, index: 0 });
  assert.deepEqual(validateCase(caseObj, { bedUsers }).errors, []);
});

test('mintAll: stable order, N per template, byte-identical across same-seed calls', () => {
  const templates = new Map([[isolationTemplate().id, isolationTemplate()]]);
  const a = mintAll(templates, { bedUsers, seed: 42 });
  const b = mintAll(templates, { bedUsers, seed: 42 });
  assert.equal(a.length, 5);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = mintAll(templates, { bedUsers, seed: 99 });
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
});
