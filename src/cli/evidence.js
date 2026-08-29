import { readFileSync, writeFileSync } from 'node:fs';
import { deriveAkelaEvidence, sectionEvidence } from '../akela.js';
import { akelaBin, ensureAkelaConfig, recordRun, outcomeStatus, AkelaError } from '../akela-bridge.js';
import { parseEvidence, routeVerdicts } from '../triage.js';
import { loadIntentDir } from '../intent.js';

export async function main(ctx) {
  const { flags } = ctx;
  if (!flags.evidence) {
    console.error('peira evidence needs --evidence <run.jsonl> [--triage <proposals.json>] [--intent <dir>] [--out <path>] [--no-akela]');
    return 2;
  }
  const runText = readFileSync(flags.evidence, 'utf8');
  const proposals = flags.triage ? JSON.parse(readFileSync(flags.triage, 'utf8')) : null;
  let records;
  try {
    records = deriveAkelaEvidence(runText, proposals);
  } catch (err) {
    console.error(`ERROR ${err.message}`);
    return 1;
  }

  // the portable per-case export, always written
  const outPath = flags.out ?? flags.evidence.replace(/\.jsonl$/, '') + '-akela.jsonl';
  writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  const counts = records.reduce((acc, r) => ((acc[r.event] = (acc[r.event] ?? 0) + 1), acc), {});
  console.log(`${records.length} evidence record(s) (${JSON.stringify(counts)}) → ${outPath}`);

  // the real thing: record the run into Akela as a domain (deduped per section)
  if (flags['no-akela']) return 0;
  if (!akelaBin()) {
    console.error('warn  akela is not installed — export written, nothing recorded (install akela or pass --no-akela to silence this)');
    return 0;
  }
  if (!flags.intent) {
    console.error('warn  no --intent <dir> — Akela source ids need the live intent sections; export written, nothing recorded');
    return 0;
  }
  const sections = loadIntentDir(flags.intent);
  const { applied, contradicted, unmapped } = sectionEvidence(records, sections);
  for (const id of unmapped) console.error(`warn  intent section "${id}" not found in ${flags.intent} — its evidence was not recorded`);
  if (applied.length === 0 && contradicted.length === 0) {
    console.log('nothing to record into Akela (no adjudicated section evidence)');
    return 0;
  }

  const parsed = parseEvidence(runText);
  const verdictCounts = { pass: 0, fail: 0, error: 0 };
  for (const v of parsed.verdicts) verdictCounts[v.verdict] += 1;
  routeVerdicts(parsed.verdicts); // (explicitness: routing is what excluded errors upstream)

  try {
    const root = process.cwd();
    const { created } = ensureAkelaConfig(root, { intentDir: flags.intent });
    if (created) console.error('akela.json generated (Peira domain: intent/ indexed as PEIRA, tag <!-- peira: … -->)');
    const result = recordRun(root, {
      seed: parsed.seed,
      applied,
      contradicted,
      status: outcomeStatus(verdictCounts),
    });
    console.log(`akela run ${result.run}: ${result.applied} section(s) applied, ${result.contradicted} contradicted, outcome ${result.status}`);
  } catch (err) {
    if (err instanceof AkelaError) {
      console.error(`ERROR ${err.message}`);
      return 1;
    }
    throw err;
  }
  return 0;
}
