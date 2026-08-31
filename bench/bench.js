// Peira's own performance record: `npm run bench`. Measures the TOOL, never the AUT —
// DESIGN.md's benchmarking non-goal forbids latency assertions on the service under test;
// measuring Peira itself is the "measured, not promised" ethos applied to Peira.
//
// Methodology: everything runs against the in-repo fixture on loopback, so network is ~free
// and the service answers instantly — what remains visible is Peira's own overhead. The
// synthetic workload is poll-free and serial where overhead is derived (wallMs − httpMs is
// only a clean partition there). Numbers are recorded per release in docs/findings/.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCases } from '../dist/runner.js';
import { loadCases } from '../dist/load.js';
import { startFixture } from '../test/fixtures/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, '..', 'bin', 'peira.js');
const casesDir = join(here, '..', 'cases');

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// async spawn, NOT spawnSync — the fixture runs in this process, and a blocked event loop
// would deadlock every child request against it
async function timeProcess(args, okStatuses, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const r = await execFileP('node', [binPath, ...args], { encoding: 'utf8' }).catch((err) => err);
    samples.push(performance.now() - started);
    const status = r.code ?? 0;
    if (!okStatuses.includes(status)) throw new Error(`bench process exited ${status}: ${r.stderr}`);
  }
  return Math.round(median(samples));
}

function syntheticCase(n) {
  return {
    file: `synthetic-${n}`,
    caseObj: {
      id: `CASE-bench-${n}`,
      from: { intent: 'bench', hash: 'abcdef' },
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: 'nope' } },
        expect: { status: 400, body: { status: 400 } },
      },
    },
  };
}

const fixture = await startFixture();
const bed = {
  baseUrl: fixture.url,
  users: { user_1: { username: 'user_1', password: 'pass_1' }, user_2: { username: 'user_2', password: 'pass_2' } },
  drain: { route: '/groovy/status', idParam: 'id', statusPath: 'body.status', terminal: ['COMPLETED', 'FAILED'] },
};
const tmp = mkdtempSync(join(tmpdir(), 'peira-bench-'));
const bedPath = join(tmp, 'bed.json');
writeFileSync(bedPath, JSON.stringify(bed));

const results = { date: new Date().toLocaleDateString('sv'), node: process.version };

// 1. boot: parse nothing, print usage (exit 2 — a usage error is the cheapest full boot)
results.bootMs = await timeProcess([], [0, 2]);

// 2. first verdict: full CLI lifecycle — boot, load + validate 26 cases, one real request, report
results.firstVerdictMs = await timeProcess(['run', casesDir, '--bed', bedPath, '--seed', '42', '--only', 'CASE-2022-1-1'], [0]);

// 3. tool overhead per case: 500 poll-free synthetic cases, serial, in-process
const N = 500;
const synthetic = Array.from({ length: N }, (_, i) => syntheticCase(i));
for (const [label, evidencePath] of [['memory', null], ['file', join(tmp, 'bench-evidence.jsonl')]]) {
  const r = await runCases(synthetic, { bed, seed: 7, evidencePath });
  if (r.counts.pass !== N) throw new Error(`bench workload broken: ${JSON.stringify(r.counts)}`);
  results[`overheadPerCaseMs_${label}`] = Number(((r.wallMs - r.httpMs) / N).toFixed(3));
  results[`syntheticWallMs_${label}`] = r.wallMs;
  results[`syntheticHttpMs_${label}`] = r.httpMs;
}

// 4. parallel scaling on the real corpus (includes polling + drain cases; fixture queue depth 2)
const { loaded } = loadCases(casesDir);
for (const parallel of [1, 4, 8]) {
  fixture.reset();
  const r = await runCases(loaded, { bed, seed: 42, parallel });
  if (r.counts.fail + r.counts.error > 0) throw new Error(`corpus not green: ${JSON.stringify(r.counts)}`);
  results[`corpusWallMs_p${parallel}`] = r.wallMs;
}

await fixture.close();

console.log('\npeira bench — tool overhead, fixture on loopback\n');
console.log(`  boot (usage print)              ${results.bootMs} ms`);
console.log(`  first verdict (full CLI, 1 case) ${results.firstVerdictMs} ms`);
console.log(`  overhead/case, evidence in memory ${results.overheadPerCaseMs_memory} ms  (${N} cases: wall ${results.syntheticWallMs_memory} ms, http ${results.syntheticHttpMs_memory} ms)`);
console.log(`  overhead/case, evidence to file   ${results.overheadPerCaseMs_file} ms  (${N} cases: wall ${results.syntheticWallMs_file} ms, http ${results.syntheticHttpMs_file} ms)`);
console.log(`  corpus (26 cases) serial          ${results.corpusWallMs_p1} ms`);
console.log(`  corpus --parallel 4               ${results.corpusWallMs_p4} ms`);
console.log(`  corpus --parallel 8               ${results.corpusWallMs_p8} ms`);
console.log('\nJSON:');
console.log(JSON.stringify(results, null, 2));
