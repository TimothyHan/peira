import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSections, buildContract, buildPrompt } from '../dist/compile.js';
import { parseIntent } from '../dist/intent.js';

const sections = parseIntent(`## Submit works

Submitting returns an id.

## Manual only

Load testing — use a different tool.
`);

const validCase = (id = 'CASE-submit-001') => ({
  id,
  title: 'submit works',
  from: { intent: 'MODEL-LIES', hash: 'deadbeef9999' }, // must be overwritten
  test: { request: { method: 'post', route: '/submit', body: { code: 'x' } }, expect: { status: 200, body: { id: { $any: 'string' } } } },
});

test('valid candidates pass the gate; lineage is stamped mechanically, never trusted', async () => {
  const { accepted, manifest } = await compileSections([sections[0]], {
    llm: async () => JSON.stringify({ cases: [validCase()] }),
  });
  assert.equal(accepted.length, 1);
  assert.deepEqual(accepted[0].caseObj.from, { intent: 'submit-works', hash: sections[0].hash });
  assert.equal(manifest.sections[0].outcome, 'compiled');
});

test('malformed candidates are refused with the validator errors in the manifest', async () => {
  const bad = validCase();
  bad.test.assert = { status: 200 }; // unknown key — the schema refuses what it does not name
  const { accepted, manifest } = await compileSections([sections[0]], {
    llm: async () => JSON.stringify({ cases: [bad] }),
  });
  assert.equal(accepted.length, 0);
  assert.equal(manifest.sections[0].outcome, 'refused');
  assert.ok(manifest.sections[0].refused[0].errors.some((e) => /"assert"/.test(e)));
});

test('non-JSON model output refuses the whole section, never crashes', async () => {
  const { accepted, manifest } = await compileSections([sections[0]], {
    llm: async () => 'Sure! Here are some great test ideas:\n1. Try submitting…',
  });
  assert.equal(accepted.length, 0);
  assert.equal(manifest.sections[0].outcome, 'unparseable');
});

test('a skip response is recorded with its reason — dropping with evidence, not hallucinating', async () => {
  const { manifest } = await compileSections([sections[1]], {
    llm: async () => JSON.stringify({ skip: 'load testing is not functional API testing' }),
  });
  assert.equal(manifest.sections[0].outcome, 'skipped');
  assert.match(manifest.sections[0].skipReason, /load testing/);
});

test('duplicate case ids across sections: second occurrence refused', async () => {
  const { accepted, manifest } = await compileSections(sections, {
    llm: async () => JSON.stringify({ cases: [validCase('CASE-dup-001')] }),
  });
  assert.equal(accepted.length, 1);
  assert.ok(manifest.sections[1].refused[0].errors.some((e) => /duplicate/.test(e)));
});

test('a throwing transport is a transport-error outcome, isolated per section', async () => {
  let call = 0;
  const { accepted, manifest } = await compileSections(sections, {
    llm: async () => {
      if (call++ === 0) throw new Error('boom');
      return JSON.stringify({ cases: [validCase()] });
    },
  });
  assert.equal(manifest.sections[0].outcome, 'transport-error');
  assert.equal(manifest.sections[1].outcome, 'compiled');
  assert.equal(accepted.length, 1);
});

test('every section appears in the manifest exactly once; code-fenced output still parses', async () => {
  const { manifest } = await compileSections(sections, {
    llm: async () => '```json\n' + JSON.stringify({ skip: 'n/a' }) + '\n```',
  });
  assert.deepEqual(manifest.sections.map((s) => s.id), sections.map((s) => s.id));
  assert.ok(manifest.sections.every((s) => s.outcome === 'skipped'));
});

test('the contract names the principals but never their passwords; prompt isolates the target section', () => {
  const bedUsers = { user_1: { username: 'user_1', password: 'pass_1' } };
  const contract = buildContract({ bedUsers });
  assert.ok(contract.includes('$users.user_1'));
  assert.ok(!contract.includes('pass_1'));
  const prompt = buildPrompt(sections[0], { contract, fullDocument: 'FULL DOC HERE' });
  assert.ok(prompt.includes('Compile ONLY this section'));
  assert.ok(prompt.includes('FULL DOC HERE'));
});
