// PR5 gate experiment: run every pre-registered shift, triage the failures, score against
// ground truth. ~1 model call per shift through the author's session. Results land in
// experiments/triage-precision/results.json; the findings doc reads from there.
// Run: node scripts/triage-precision.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANTS } from '../test/fixtures/plants.js';
import { startFixture } from '../test/fixtures/server.js';
import { loadCases } from '../dist/load.js';
import { loadIntentDir, parseIntent } from '../dist/intent.js';
import { loadTemplates } from '../dist/validate.js';
import { runCases } from '../dist/runner.js';
import { triageRun } from '../dist/triage.js';
import { claudeCliTransport } from '../dist/llm.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'experiments', 'triage-precision');
mkdirSync(outDir, { recursive: true });

const bedUsers = {
  user_1: { username: 'user_1', password: 'pass_1' },
  user_2: { username: 'user_2', password: 'pass_2' },
};
const drain = { route: '/groovy/status', idParam: 'id', statusPath: 'body.status', terminal: ['COMPLETED', 'FAILED'] };
const sections = loadIntentDir(join(root, 'intent'));
const corpus = loadCases(join(root, 'cases')).loaded;
const llm = claudeCliTransport();

async function runShift(name, { plant, templates }) {
  const fixture = await startFixture({ plant });
  const bed = { baseUrl: fixture.url, users: bedUsers, drain };
  try {
    const run = await runCases(templates ? [] : corpus, { bed, baseUrl: fixture.url, seed: 42, templates: templates ?? new Map() });
    const evidenceText = run.events.map((e) => JSON.stringify(e)).join('\n');
    if (run.counts.fail === 0) return { name, counts: run.counts, outcome: 'no-failure' };
    const { proposals } = await triageRun({ evidenceText, sections, llm });
    const tally = { bug: 0, drift: 0, flake: 0 };
    for (const v of proposals.verdicts) tally[v.classification] += 1;
    const majority = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    return {
      name,
      counts: run.counts,
      outcome: 'triaged',
      tally,
      majority,
      refused: proposals.refused,
      uncovered: proposals.uncovered,
      verdicts: proposals.verdicts,
    };
  } finally {
    await fixture.close();
  }
}

const results = [];
for (const [name, plantDef] of Object.entries(PLANTS)) {
  process.stderr.write(`shift ${name} (truth: ${plantDef.truth}) … `);
  const result = await runShift(name, { plant: name });
  result.truth = plantDef.truth;
  result.correct = result.outcome === 'triaged' ? result.majority === plantDef.truth : null;
  results.push(result);
  process.stderr.write(`${result.outcome}${result.majority ? ` → ${result.majority} ${result.correct ? '✓' : '✗'}` : ''}\n`);
}

// the standing-bug check: unplanted fixture, isolation invariant — BUG-2022-01 must triage as bug
process.stderr.write('standing-check BUG-2022-01 (truth: bug) … ');
const { templates } = loadTemplates(join(root, 'experiments', 'invariants', 'templates'), { bedUsers });
const isolationOnly = new Map([...templates].filter(([id]) => /result-isolation/.test(id)));
const standing = await runShift('standing-bug-2022-01', { plant: null, templates: isolationOnly });
standing.truth = 'bug';
standing.correct = standing.outcome === 'triaged' ? standing.majority === 'bug' : null;
results.push(standing);
process.stderr.write(`${standing.outcome}${standing.majority ? ` → ${standing.majority} ${standing.correct ? '✓' : '✗'}` : ''}\n`);

// score
const graded = results.filter((r) => r.outcome === 'triaged');
const matrix = {};
for (const r of graded) {
  matrix[r.truth] ??= { bug: 0, drift: 0, flake: 0 };
  matrix[r.truth][r.majority] += 1;
}
const bugDriftConfusions = graded.filter((r) => (r.truth === 'bug' && r.majority === 'drift') || (r.truth === 'drift' && r.majority === 'bug')).length;
const summary = {
  shifts: results.length,
  graded: graded.length,
  noFailure: results.filter((r) => r.outcome === 'no-failure').map((r) => r.name),
  correct: graded.filter((r) => r.correct).length,
  matrix,
  bugDriftConfusions,
  bugDriftConfusionRate: graded.length ? bugDriftConfusions / graded.length : null,
};

writeFileSync(join(outDir, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nfull results: ${join(outDir, 'results.json')}`);
