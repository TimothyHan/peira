import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAkelaEvidence, sectionEvidence } from '../src/akela.js';

const lineage = (extra = {}) => ({ intent: 'result-isolation', hash: 'abcdef123456', ...extra });
const evidence = (verdictRows) =>
  [
    { event: 'run-start', seed: 42 },
    ...verdictRows.flatMap(([id, verdict, from]) => [
      { event: 'case-start', case: id, definition: { id, from } },
      { event: 'case-verdict', id, verdict, ...(verdict === 'fail' ? { reason: 'assertion failed' } : {}) },
    ]),
    { event: 'run-end', seed: 42 },
  ].map((e) => JSON.stringify(e)).join('\n');

test('pass → applied, carrying intent lineage and template provenance', () => {
  const text = evidence([
    ['CASE-a-001', 'pass', lineage()],
    ['CASE-tpl-001-g2', 'pass', lineage({ template: 'TPL-x-001', seed: 42, instance: 2 })],
  ]);
  const records = deriveAkelaEvidence(text);
  assert.deepEqual(records[0], { event: 'applied', via: 'pass', intent: 'result-isolation', hash: 'abcdef123456', case: 'CASE-a-001', seed: 42 });
  assert.deepEqual({ template: records[1].template, instance: records[1].instance }, { template: 'TPL-x-001', instance: 2 });
});

test('the corrected mapping: bug → applied (the knowledge did its job); drift → contradicted; flake/untriaged → nothing', () => {
  const text = evidence([
    ['CASE-bug-001', 'fail', lineage()],
    ['CASE-drift-001', 'fail', lineage({ intent: 'other-section' })],
    ['CASE-flake-001', 'fail', lineage()],
    ['CASE-silent-001', 'fail', lineage()],
  ]);
  const proposals = {
    seed: 42,
    verdicts: [
      { case: 'CASE-bug-001', classification: 'bug', rationale: 'service violates the intent' },
      { case: 'CASE-drift-001', classification: 'drift', rationale: 'wording the intent never pinned' },
      { case: 'CASE-flake-001', classification: 'flake', rationale: 'intermittent' },
    ],
  };
  const records = deriveAkelaEvidence(text, proposals);
  assert.deepEqual(records.map((r) => [r.case, r.event, r.via]), [
    ['CASE-bug-001', 'applied', 'triage:bug'],
    ['CASE-drift-001', 'contradicted', 'triage:drift'],
  ]);
  assert.equal(records[1].note, 'wording the intent never pinned');
});

test('error verdicts and failures with no triage export nothing; mixed-run triage refused', () => {
  const text = evidence([
    ['CASE-dead-001', 'error', lineage()],
    ['CASE-fail-001', 'fail', lineage()],
  ]);
  assert.deepEqual(deriveAkelaEvidence(text), []);
  assert.throws(() => deriveAkelaEvidence(text, { seed: 99, verdicts: [] }), /refusing to mix runs/);
});

test('section evidence: deduped per section, contradiction dominates a mixed section, ids map through the intent file', () => {
  const sections = [
    { id: 'result-isolation', file: '2022-test-plan.md' },
    { id: 'other-section', file: 'demo.md' },
  ];
  const records = [
    { event: 'applied', via: 'pass', intent: 'result-isolation', case: 'CASE-a-001' },
    { event: 'applied', via: 'pass', intent: 'result-isolation', case: 'CASE-b-001' },
    { event: 'applied', via: 'triage:bug', intent: 'other-section', case: 'CASE-c-001' },
    { event: 'contradicted', via: 'triage:drift', intent: 'other-section', case: 'CASE-d-001', note: 'reworded' },
    { event: 'applied', via: 'pass', intent: 'ghost-section', case: 'CASE-e-001' },
  ];
  const { applied, contradicted, unmapped } = sectionEvidence(records, sections);
  assert.deepEqual(applied, ['PEIRA-2022-test-plan#result-isolation']); // two cases, ONE applied
  assert.deepEqual(contradicted, [{ src: 'PEIRA-demo#other-section', note: 'reworded' }]); // contradiction beats the bug-applied
  assert.deepEqual(unmapped, ['ghost-section']);
});

test('deterministic: same inputs, byte-identical output', () => {
  const text = evidence([['CASE-a-001', 'pass', lineage()], ['CASE-b-001', 'pass', lineage()]]);
  assert.equal(JSON.stringify(deriveAkelaEvidence(text)), JSON.stringify(deriveAkelaEvidence(text)));
});
