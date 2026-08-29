import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateTriageOutput } from '../src/triage.js';

const failureIds = new Set(['CASE-a-001', 'CASE-b-001']);
const bug = (caseId = 'CASE-a-001') => ({
  case: caseId,
  classification: 'bug',
  rationale: 'contradicts the intent',
  finding: { title: 't', intent: 'x', expected: '403', actual: '401' },
});

test('a valid verdict array passes the gate', () => {
  const raw = JSON.stringify({ verdicts: [bug(), { case: 'CASE-b-001', classification: 'drift', rationale: 'wording only', intentDiff: { section: 's', current: 'a', proposed: 'b' } }] });
  const gated = gateTriageOutput(raw, failureIds);
  assert.deepEqual({ verdicts: gated.verdicts.length, errors: gated.errors, uncovered: gated.uncovered }, { verdicts: 2, errors: [], uncovered: [] });
});

test('per-class payloads are required: bug→finding, drift→intentDiff, flake→prescription', () => {
  for (const [cls, wrongPayload] of [['bug', 'intentDiff'], ['drift', 'prescription'], ['flake', 'finding']]) {
    const v = { case: 'CASE-a-001', classification: cls, rationale: 'r' };
    v[wrongPayload] = cls === 'bug' ? { section: 's', current: 'a', proposed: 'b' } : cls === 'drift' ? 're-run' : bug().finding;
    const gated = gateTriageOutput(JSON.stringify({ verdicts: [v] }), failureIds);
    assert.equal(gated.verdicts.length, 0);
    assert.ok(gated.errors.some((e) => new RegExp(`requires`).test(e)), gated.errors.join());
    assert.deepEqual(gated.uncovered.sort(), [...failureIds].sort());
  }
});

test('invented case ids and duplicates are refused; uncovered failures are reported', () => {
  const raw = JSON.stringify({ verdicts: [bug('CASE-invented-001'), bug(), bug()] });
  const gated = gateTriageOutput(raw, failureIds);
  assert.equal(gated.verdicts.length, 1);
  assert.ok(gated.errors.some((e) => /not a failure in this run/.test(e)));
  assert.ok(gated.errors.some((e) => /more than once/.test(e)));
  assert.deepEqual(gated.uncovered, ['CASE-b-001']);
});

test('wrong enum, garbage, prose, and partial JSON are refused whole', () => {
  for (const raw of [
    JSON.stringify({ verdicts: [{ case: 'CASE-a-001', classification: 'maybe', rationale: 'r' }] }),
    'The failures look like bugs to me!',
    '{"verdicts": [{"case": "CASE-a-001"',
    JSON.stringify({ notVerdicts: [] }),
  ]) {
    const gated = gateTriageOutput(raw, failureIds);
    assert.equal(gated.verdicts.length, 0, raw.slice(0, 40));
    assert.ok(gated.errors.length > 0);
  }
});

test('code-fenced output still parses', () => {
  const raw = '```json\n' + JSON.stringify({ verdicts: [bug()] }) + '\n```';
  assert.equal(gateTriageOutput(raw, failureIds).verdicts.length, 1);
});
