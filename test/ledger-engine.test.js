// TRUE integration: these tests drive the real, installed ledger engine (akela — first-party,
// deterministic, no network) in a scratch project — the QABuddy-style launcher pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineBin, ensureLedgerConfig, runEngine, recordRun, outcomeStatus, LedgerError } from '../src/ledger-engine.js';

function scratchProject() {
  const root = mkdtempSync(join(tmpdir(), 'peira-ledger-'));
  mkdirSync(join(root, 'intent'));
  writeFileSync(join(root, 'intent', 'plan.md'), `# Plan

## Result isolation
<!-- peira: id=result-isolation kind=invariant -->
Only the submitter sees results.

## Submit works
<!-- peira: id=submit-works kind=ac -->
A valid submission is accepted.
`);
  return root;
}

test('the ledger engine is installed and resolvable', () => {
  assert.ok(engineBin(), 'the ledger engine (akela) must be installed');
});

test('ensureLedgerConfig generates a config the real engine accepts; peira tags index natively', () => {
  const root = scratchProject();
  const { created } = ensureLedgerConfig(root);
  assert.equal(created, true);
  assert.equal(ensureLedgerConfig(root).created, false); // never overwrites

  const { stdout } = runEngine(root, ['index', '--json']);
  const index = JSON.parse(stdout);
  const ids = Object.keys(index.index ?? index);
  assert.ok(ids.includes('PEIRA-plan#result-isolation'), JSON.stringify(ids));
  assert.ok(ids.includes('PEIRA-plan#submit-works'));
});

test('the ledger lives under .peira/ — the engine surfaces nowhere in the project but akela.json', () => {
  const root = scratchProject();
  ensureLedgerConfig(root);
  assert.ok(existsSync(join(root, '.peira', 'LEARNINGS.md')), 'learnings under .peira/');
  assert.ok(!existsSync(join(root, 'akela')), 'no akela/ directory in the user project');
});

test('recordRun: a full run lands in the ledger — applied, contradicted with note, outcome', () => {
  const root = scratchProject();
  ensureLedgerConfig(root);
  const result = recordRun(root, {
    seed: 42,
    applied: ['PEIRA-plan#result-isolation'],
    contradicted: [{ src: 'PEIRA-plan#submit-works', note: 'the service answers 202 where the intent text says 200' }],
    status: 'DONE_WITH_CONCERNS',
  });
  assert.match(result.run, /^run-seed-42-/);

  const log = readFileSync(join(root, '.peira', 'learnings-log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const events = log.filter((l) => l.run === result.run);
  const byEvent = Object.fromEntries(events.map((e) => [e.event + ':' + (e.src ?? e.status ?? ''), e]));
  assert.ok(byEvent['applied:PEIRA-plan#result-isolation']);
  assert.ok(byEvent['contradicted:PEIRA-plan#submit-works']);
  assert.match(byEvent['contradicted:PEIRA-plan#submit-works'].note, /202 where the intent/);
  assert.ok(byEvent['outcome:DONE_WITH_CONCERNS']);
  assert.ok(existsSync(join(root, '.peira', 'runs', result.run, 'events.jsonl')), 'per-run mirror exists');
});

test('the engine refuses evidence against unknown sections — the gate works across the bridge', () => {
  const root = scratchProject();
  ensureLedgerConfig(root);
  assert.throws(
    () => recordRun(root, { seed: 1, applied: ['PEIRA-plan#no-such-section'], contradicted: [], status: 'DONE' }),
    LedgerError,
  );
});

test('outcome status mapping', () => {
  assert.equal(outcomeStatus({ pass: 5, fail: 0, error: 0 }), 'DONE');
  assert.equal(outcomeStatus({ pass: 4, fail: 1, error: 0 }), 'DONE_WITH_CONCERNS');
  assert.equal(outcomeStatus({ pass: 0, fail: 0, error: 3 }), 'BLOCKED');
});
