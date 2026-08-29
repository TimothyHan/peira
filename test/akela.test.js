import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAkelaEvidence } from '../src/akela.js';

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
  assert.deepEqual(records[0], { event: 'applied', intent: 'result-isolation', hash: 'abcdef123456', case: 'CASE-a-001', seed: 42 });
  assert.deepEqual({ template: records[1].template, instance: records[1].instance }, { template: 'TPL-x-001', instance: 2 });
});

test('triaged bug → contradicted/service; drift → contradicted/case; flake and untriaged → nothing', () => {
  const text = evidence([
    ['CASE-bug-001', 'fail', lineage()],
    ['CASE-drift-001', 'fail', lineage()],
    ['CASE-flake-001', 'fail', lineage()],
    ['CASE-silent-001', 'fail', lineage()],
  ]);
  const proposals = {
    seed: 42,
    verdicts: [
      { case: 'CASE-bug-001', classification: 'bug' },
      { case: 'CASE-drift-001', classification: 'drift' },
      { case: 'CASE-flake-001', classification: 'flake' },
    ],
  };
  const records = deriveAkelaEvidence(text, proposals);
  assert.deepEqual(records.map((r) => [r.case, r.event, r.subject, r.via]), [
    ['CASE-bug-001', 'contradicted', 'service', 'triage:bug'],
    ['CASE-drift-001', 'contradicted', 'case', 'triage:drift'],
  ]);
});

test('error verdicts export nothing; failures with no triage at all export nothing', () => {
  const text = evidence([
    ['CASE-dead-001', 'error', lineage()],
    ['CASE-fail-001', 'fail', lineage()],
  ]);
  assert.deepEqual(deriveAkelaEvidence(text), []);
});

test('a triage file from a different run is refused', () => {
  const text = evidence([['CASE-a-001', 'fail', lineage()]]);
  assert.throws(() => deriveAkelaEvidence(text, { seed: 99, verdicts: [] }), /refusing to mix runs/);
});

test('deterministic: same inputs, byte-identical output', () => {
  const text = evidence([['CASE-a-001', 'pass', lineage()], ['CASE-b-001', 'pass', lineage()]]);
  assert.equal(JSON.stringify(deriveAkelaEvidence(text)), JSON.stringify(deriveAkelaEvidence(text)));
});
