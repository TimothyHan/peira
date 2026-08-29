import { readFileSync, writeFileSync } from 'node:fs';
import { loadIntentDir } from '../intent.js';
import { triageRun } from '../triage.js';
import { claudeCliTransport } from '../llm.js';

export async function main(ctx) {
  const { flags } = ctx;
  if (!flags.evidence || !flags.intent) {
    console.error('peira triage needs --evidence <run.jsonl> and --intent <dir>');
    return 2;
  }
  const evidenceText = readFileSync(flags.evidence, 'utf8');
  const sections = loadIntentDir(flags.intent);
  const { proposals, called } = await triageRun({ evidenceText, sections, llm: claudeCliTransport() });
  const outPath = flags.out ?? flags.evidence.replace(/\.jsonl$/, '') + '-triage.json';
  writeFileSync(outPath, JSON.stringify(proposals, null, 2) + '\n');

  for (const v of proposals.infra) console.log(`INFRA ${v.case} — ${v.bucket}`);
  for (const v of proposals.verdicts) console.log(`${v.classification.toUpperCase().padEnd(5)} ${v.case} — ${v.rationale}`);
  for (const msg of proposals.refused) console.error(`refused: ${msg}`);
  for (const id of proposals.uncovered) console.error(`uncovered: ${id} — no gate-passing verdict proposed`);
  console.log(called ? `\nproposals (nothing applied): ${outPath}` : `\nno failures to triage — nothing was sent to the model (${outPath})`);
  return 0;
}
