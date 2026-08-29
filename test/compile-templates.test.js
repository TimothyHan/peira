// The compiler's invariant protocol: templates through the gate, lineage mechanical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSections, buildContract } from '../src/compile.js';
import { parseIntent } from '../src/intent.js';
import { isolationTemplate } from './helpers.js';
import { makeBed } from './helpers.js';

const bedUsers = makeBed('http://x').users;
const sections = parseIntent(`## Result isolation
<!-- peira: id=result-isolation kind=invariant -->
Results are visible only to the submitter: any other user gets 403.
`);

test('an emitted template passes the gate with mechanical lineage; the manifest records it', async () => {
  const candidate = isolationTemplate({ from: { intent: 'LIES', hash: 'ffffffffffff' } });
  const { acceptedTemplates, manifest } = await compileSections(sections, {
    bedUsers,
    llm: async () => JSON.stringify({ templates: [candidate] }),
  });
  assert.equal(acceptedTemplates.length, 1);
  assert.deepEqual(acceptedTemplates[0].tplObj.from, { intent: 'result-isolation', hash: sections[0].hash });
  assert.deepEqual(manifest.sections[0].templates, ['TPL-result-isolation-001']);
  assert.equal(manifest.sections[0].outcome, 'compiled');
});

test('a malformed template is refused with validator errors in the manifest', async () => {
  const bad = isolationTemplate();
  bad.holes.script = { kind: 'javascript' }; // not in the closed vocabulary
  const { acceptedTemplates, manifest } = await compileSections(sections, {
    bedUsers,
    llm: async () => JSON.stringify({ templates: [bad] }),
  });
  assert.equal(acceptedTemplates.length, 0);
  assert.equal(manifest.sections[0].outcome, 'refused');
  assert.ok(manifest.sections[0].refusedTemplates[0].errors.some((e) => /kind must be one of/.test(e)));
});

test('the contract teaches the template protocol', () => {
  const contract = buildContract({ bedUsers });
  assert.match(contract, /kind=invariant.*emit ONE template/s);
  assert.match(contract, /distinctFrom/);
  assert.match(contract, /holes\.<name>\.result/);
});
