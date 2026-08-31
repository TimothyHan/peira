// Compile-quality eval: `npm run eval:compile`. OPT-IN, not part of `npm test` — it spends a
// real Claude session, so it is a ritual (before a release, after a prompt or model change),
// not a CI gate. The suite's canned transports prove the compile *plumbing*; this proves the
// compile *quality*, which a prompt edit can silently degrade while every test stays green.
//
// What it measures, end to end against the repo's own intent:
//   1. gate pass-rate — sections that produced schema-admitted artifacts vs refused/unparseable
//   2. lineage integrity — every accepted artifact stamped with its section id + live hash
//   3. executable truth — the compiled cases validate, then RUN green against the fixture
//
// A number that moves is the signal, so the run must OUTLIVE the scrollback: every run appends
// one row to docs/findings/compile-eval-log.md and writes its full report + compiled artifacts
// under .eval-runs/<date>-<contractHash>/ (override with --out <dir>).
//
//   node eval/compile-eval.js [intentDir] [--out <dir>]

import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIntentDir } from '../dist/intent.js';
import { compileSections } from '../dist/compile.js';
import { claudeCliTransport } from '../dist/llm.js';
import { validateCaseSet } from '../dist/validate.js';
import { runCases } from '../dist/runner.js';
import { COMPILE_MODEL } from '../dist/constants.js';
import { startFixture } from '../test/fixtures/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outOverride = outFlag === -1 ? null : args[outFlag + 1];
const positionals = args.filter((a, i) => outFlag === -1 || (i !== outFlag && i !== outFlag + 1));
const intentDir = positionals[0] ?? join(repoRoot, 'intent');

const fixture = await startFixture();
const bed = {
  baseUrl: fixture.url,
  users: {
    user_1: { username: 'user_1', password: 'pass_1' },
    user_2: { username: 'user_2', password: 'pass_2' },
  },
  drain: { route: '/groovy/status', idParam: 'id', statusPath: 'body.status', terminal: ['COMPLETED', 'FAILED'] },
};

const sections = loadIntentDir(intentDir);
const fullDocument = sections.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n');
console.log(`compile eval — ${sections.length} section(s) from ${intentDir}`);
console.log(`model ${COMPILE_MODEL} · live session (this spends tokens)\n`);

const started = performance.now();
const { accepted, acceptedSteps, acceptedTemplates, manifest } = await compileSections(sections, {
  llm: claudeCliTransport(),
  bedUsers: bed.users,
  fullDocument,
  model: COMPILE_MODEL,
  onProgress: (msg) => console.log(`  ${msg}`),
});
const compileMs = Math.round(performance.now() - started);

// 1. gate pass-rate
const outcomes = {};
for (const entry of manifest.sections) outcomes[entry.outcome ?? 'none'] = (outcomes[entry.outcome ?? 'none'] ?? 0) + 1;
const refusedCount = manifest.sections.reduce((n, e) => n + (e.refused?.length ?? 0), 0);
const compiled = outcomes.compiled ?? 0;

// 2. lineage integrity — stamped mechanically, so a miss is a bug, not a model failure
const live = new Map(sections.map((s) => [s.id, s.hash]));
const badLineage = accepted.filter(({ caseObj }) => live.get(caseObj.from?.intent) !== caseObj.from?.hash);

// 3. executable truth — validate, then run green
const loaded = accepted.map(({ caseObj }, i) => ({ file: `compiled-${i}.json`, caseObj }));
const steps = new Map(acceptedSteps.map(({ stepObj }) => [stepObj.id, stepObj]));
const templates = new Map(acceptedTemplates.map(({ tplObj }) => [tplObj.id, tplObj]));
const { results, ok } = validateCaseSet(loaded, { bedUsers: bed.users, steps });
const validationErrors = results.flatMap((r) => r.errors.map((e) => `${r.id ?? r.file}: ${e}`));

let counts = { pass: 0, fail: 0, error: 0 };
let verdicts = [];
if (ok && loaded.length > 0) {
  ({ counts, verdicts } = await runCases(loaded, { bed, seed: 42, steps, templates }));
}
await fixture.close();

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const today = new Date().toLocaleDateString('sv');
const report = {
  date: today,
  model: COMPILE_MODEL,
  contractHash: manifest.contractHash,
  sections: sections.length,
  outcomes,
  gatePassRate: pct(compiled, sections.length),
  candidatesRefused: refusedCount,
  cases: accepted.length,
  steps: acceptedSteps.length,
  templates: acceptedTemplates.length,
  lineageIntact: badLineage.length === 0,
  validationErrors: validationErrors.length,
  verdicts: counts,
  compileMs,
  intentDir: relative(repoRoot, intentDir) || '.',
};

// durable output: this run is expensive and rarely repeated — it must outlive the scrollback
const outDir = outOverride ?? join(repoRoot, '.eval-runs', `${today}-${manifest.contractHash}`);
mkdirSync(join(outDir, 'cases'), { recursive: true });
for (const { caseObj } of accepted) writeFileSync(join(outDir, 'cases', `${caseObj.id}.json`), JSON.stringify(caseObj, null, 2) + '\n');
for (const { stepObj } of acceptedSteps) writeFileSync(join(outDir, `${stepObj.id}.json`), JSON.stringify(stepObj, null, 2) + '\n');
for (const { tplObj } of acceptedTemplates) writeFileSync(join(outDir, `${tplObj.id}.json`), JSON.stringify(tplObj, null, 2) + '\n');
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ...report, validationErrors, failures: verdicts.filter((v) => v.verdict !== 'pass') }, null, 2) + '\n');

// One appended row per run — the history IS the signal; a number that moves is what you read.
// Only runs against the repo's OWN intent join the trend: a scratch dir (the cheap first run)
// would otherwise enter a 1-section row into a table about the 24-section corpus.
const logPath = join(repoRoot, 'docs', 'findings', 'compile-eval-log.md');
const isCorpusRun = resolve(intentDir) === resolve(join(repoRoot, 'intent'));
if (isCorpusRun && !existsSync(logPath)) {
  writeFileSync(logPath, `# Compile eval log

One row per \`npm run eval:compile\`. The point is the *trend*: gate pass-rate and green
verdicts should hold across prompt edits and model changes — a number that moves is the
signal to go read that run's report. Full reports and compiled artifacts live in
\`.eval-runs/\` (untracked); this log is the durable record.

| date | model | contract | sections | gate pass | cases | lineage | validation | verdicts (p/f/e) |
|---|---|---|---|---|---|---|---|---|
`);
}
if (isCorpusRun) {
  appendFileSync(
    logPath,
    `| ${today} | ${COMPILE_MODEL} | ${manifest.contractHash} | ${sections.length} | ${report.gatePassRate} | ${accepted.length} | ${report.lineageIntact ? 'ok' : 'BROKEN'} | ${validationErrors.length === 0 ? 'clean' : `${validationErrors.length} err`} | ${counts.pass}/${counts.fail}/${counts.error} |\n`,
  );
}

console.log('\n=== compile eval ===\n');
console.log(`  sections            ${sections.length}  → ${JSON.stringify(outcomes)}`);
console.log(`  gate pass-rate      ${report.gatePassRate}  (${refusedCount} candidate(s) refused by the gate)`);
console.log(`  artifacts           ${accepted.length} case(s), ${acceptedSteps.length} step(s), ${acceptedTemplates.length} template(s)`);
console.log(`  lineage intact      ${report.lineageIntact ? 'yes' : `NO — ${badLineage.length} mis-stamped`}`);
console.log(`  validation          ${validationErrors.length === 0 ? 'clean' : `${validationErrors.length} error(s)`}`);
console.log(`  run vs fixture      ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error`);
console.log(`  compile wall        ${(compileMs / 1000).toFixed(1)}s`);
console.log(`\n  report + artifacts  ${relative(repoRoot, outDir) || outDir}`);
console.log(`  history row         ${isCorpusRun ? relative(repoRoot, logPath) : 'skipped — not the repo corpus, so it stays out of the trend'}`);
for (const e of validationErrors.slice(0, 10)) console.log(`    validation: ${e}`);
for (const v of verdicts.filter((v) => v.verdict !== 'pass')) console.log(`    ${v.verdict.toUpperCase()} ${v.id} — ${v.reason ?? ''}`);
console.log('\nJSON:');
console.log(JSON.stringify(report, null, 2));

// exit 1 on the things that are always bugs; a fail/error verdict may be the SERVICE's fault,
// so it is reported loudly but does not fail the eval by itself
process.exit(badLineage.length > 0 || validationErrors.length > 0 ? 1 : 0);
