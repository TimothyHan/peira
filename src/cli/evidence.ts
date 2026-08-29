import { readFileSync, writeFileSync } from 'node:fs';
import { deriveLedgerEvidence, sectionEvidence } from '../ledger.js';
import { engineBin, ensureLedgerConfig, recordRun, outcomeStatus, LedgerError } from '../ledger-engine.js';
import { parseEvidence, routeVerdicts } from '../triage.js';
import { loadIntentDir } from '../intent.js';
import type { CliContext } from './context.js';

export async function main(ctx: CliContext): Promise<number> {
  const { flags } = ctx;
  if (!flags.evidence) {
    console.error('peira evidence needs --evidence <run.jsonl> [--triage <proposals.json>] [--intent <dir>] [--out <path>] [--no-ledger]');
    return 2;
  }
  const runText = readFileSync(flags.evidence, 'utf8');
  const proposals = flags.triage ? JSON.parse(readFileSync(flags.triage, 'utf8')) : null;
  let records;
  try {
    records = deriveLedgerEvidence(runText, proposals);
  } catch (err) {
    console.error(`ERROR ${(err as Error).message}`);
    return 1;
  }

  // the portable per-case export, always written
  const outPath = flags.out ?? flags.evidence.replace(/\.jsonl$/, '') + '-ledger.jsonl';
  writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  const counts = records.reduce<Record<string, number>>((acc, r) => ((acc[r.event] = (acc[r.event] ?? 0) + 1), acc), {});
  console.log(`${records.length} evidence record(s) (${JSON.stringify(counts)}) → ${outPath}`);

  // the real thing: record the run into the evidence ledger (deduped per section)
  if (flags['no-ledger']) return 0;
  if (!engineBin()) {
    console.error('warn  the evidence ledger engine is missing — export written, nothing recorded (reinstall peira, or pass --no-ledger to silence this)');
    return 0;
  }
  if (!flags.intent) {
    console.error('warn  no --intent <dir> — ledger source ids need the live intent sections; export written, nothing recorded');
    return 0;
  }
  const sections = loadIntentDir(flags.intent);
  const { applied, contradicted, unmapped } = sectionEvidence(records, sections);
  for (const id of unmapped) console.error(`warn  intent section "${id}" not found in ${flags.intent} — its evidence was not recorded`);
  if (applied.length === 0 && contradicted.length === 0) {
    console.log('nothing to record into the ledger (no adjudicated section evidence)');
    return 0;
  }

  const parsed = parseEvidence(runText);
  const verdictCounts = { pass: 0, fail: 0, error: 0 };
  for (const v of parsed.verdicts) verdictCounts[v.verdict] += 1;
  routeVerdicts(parsed.verdicts); // (explicitness: routing is what excluded errors upstream)

  try {
    const root = process.cwd();
    const { created } = ensureLedgerConfig(root, { intentDir: flags.intent });
    if (created) console.error('evidence ledger initialized (akela.json, .peira/) — commit these so trust accrues across runs');
    const result = recordRun(root, {
      seed: parsed.seed,
      applied,
      contradicted,
      status: outcomeStatus(verdictCounts),
    });
    console.log(`ledger run ${result.run}: ${result.applied} section(s) applied, ${result.contradicted} contradicted, outcome ${result.status}`);
  } catch (err) {
    if (err instanceof LedgerError) {
      console.error(`ERROR ${err.message}`);
      return 1;
    }
    throw err;
  }
  return 0;
}
