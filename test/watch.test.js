// The watch-mode reaction planner (pure — no filesystem). The mapping leans on lineage:
// case edits re-run those cases, registry/bed edits re-run all, intent edits only re-check
// staleness because the runner never reads intent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { planReaction } from '../dist/cli/watch.js';

const targets = {
  casesDir: 'cases',
  bedPath: 'bed.json',
  intentDir: 'intent',
  ignore: ['run.jsonl'],
};

test('a changed case file re-runs exactly that case file', () => {
  const plan = planReaction(['cases/orders/create.json'], targets);
  assert.equal(plan.rerun, 'changed');
  assert.deepEqual(plan.caseFiles, [resolve('cases/orders/create.json')]);
  assert.equal(plan.checkIntent, false);
});

test('bed, steps, and templates changes re-run everything', () => {
  assert.equal(planReaction(['bed.json'], targets).rerun, 'all');
  assert.equal(planReaction(['cases/steps/STEP-sign-001.json'], targets).rerun, 'all');
  assert.equal(planReaction(['cases/templates/TPL-iso-001.json'], targets).rerun, 'all');
  assert.equal(planReaction(['registry/steps.json'], { ...targets, stepsDir: 'registry' }).rerun, 'all');
});

test('an intent edit re-checks staleness and re-runs nothing — the runner never reads intent', () => {
  const plan = planReaction(['intent/orders.md'], targets);
  assert.equal(plan.rerun, 'none');
  assert.equal(plan.checkIntent, true);
});

test('the strongest reaction wins in a mixed batch, and case files are dropped once all re-runs', () => {
  const plan = planReaction(['cases/orders/create.json', 'bed.json', 'intent/orders.md'], targets);
  assert.equal(plan.rerun, 'all');
  assert.deepEqual(plan.caseFiles, []);
  assert.equal(plan.checkIntent, true);
});

test('outputs and non-artifacts never trigger anything', () => {
  assert.equal(planReaction(['run.jsonl'], targets).rerun, 'none');
  assert.equal(planReaction(['cases/notes.txt'], targets).rerun, 'none');
  assert.equal(planReaction(['intent/scratch.txt'], targets).checkIntent, false);
});
