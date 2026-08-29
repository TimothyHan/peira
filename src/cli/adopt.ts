import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { adoptDocument } from '../adopt.js';
import { claudeCliTransport } from '../llm.js';
import type { CliContext } from './context.js';

export async function main(ctx: CliContext): Promise<number> {
  const { flags, positionals } = ctx;
  const source = positionals[0];
  if (!source || !flags.out) {
    console.error('peira adopt <messy.md> --out <intent/name.md>');
    return 2;
  }
  if (existsSync(flags.out)) {
    console.error(`refusing to overwrite ${flags.out} — adopted intent is human-owned; delete it first if you mean to re-adopt`);
    return 1;
  }
  const sourceText = readFileSync(source, 'utf8');
  const { markdown, report, errors } = await adoptDocument({ sourceText, llm: claudeCliTransport() });
  if (errors.length > 0 || report === null) {
    for (const e of errors) console.error(`ERROR ${e}`);
    console.error('\nproposal refused — nothing was written');
    return 1;
  }
  writeFileSync(flags.out, markdown + '\n');
  console.log(`adopted → ${flags.out}: ${report.sections} section(s), ${report.invariants} invariant(s)`);
  console.log(`content preservation: ${report.kept}/${report.sourceLines} source lines kept`);
  for (const line of report.dropped.slice(0, 10)) console.error(`warn  dropped from source: "${line}"`);
  if (report.dropped.length > 10) console.error(`warn  … and ${report.dropped.length - 10} more dropped lines`);
  console.log(`\nreview the file, then commit it — it is now YOUR document, the source of truth.`);
  return 0;
}
