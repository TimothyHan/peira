import { readFileSync, writeFileSync } from 'node:fs';
import { deriveAkelaEvidence } from '../akela.js';

export async function main(ctx) {
  const { flags } = ctx;
  if (!flags.evidence) {
    console.error('peira evidence needs --evidence <run.jsonl> [--triage <proposals.json>] [--out <path>]');
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
  const outPath = flags.out ?? flags.evidence.replace(/\.jsonl$/, '') + '-akela.jsonl';
  writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  const counts = records.reduce((acc, r) => ((acc[r.event] = (acc[r.event] ?? 0) + 1), acc), {});
  console.log(`${records.length} evidence record(s) (${JSON.stringify(counts)}) → ${outPath}`);
  return 0;
}
