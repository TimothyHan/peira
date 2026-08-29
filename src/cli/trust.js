// `peira trust` — the ledger standings: how much evidence each intent section has earned.
// A read-only view over the evidence ledger; run `peira evidence` after runs to feed it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { engineBin, runEngine, LedgerError } from '../ledger-engine.js';

export async function main() {
  const root = process.cwd();
  if (!existsSync(join(root, 'akela.json'))) {
    console.error('no evidence ledger yet — `peira evidence --evidence run.jsonl --intent intent` after a run starts one');
    return 2;
  }
  if (!engineBin()) {
    console.error('ERROR the evidence ledger engine is missing — reinstall peira');
    return 1;
  }
  let stats;
  try {
    stats = JSON.parse(runEngine(root, ['stats', '--json']).stdout);
  } catch (err) {
    console.error(`ERROR ${err instanceof LedgerError ? err.message : `unreadable ledger stats: ${err.message}`}`);
    return 1;
  }

  const rows = (stats.rows ?? []).slice().sort((a, b) => b.applied - a.applied || a.src.localeCompare(b.src));
  const outcomes = stats.outcomes ?? {};
  const runLine = Object.entries(outcomes).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`${stats.runs_with_outcome ?? 0} recorded run(s)${runLine ? ` (${runLine})` : ''}, ${rows.length} intent section(s)\n`);

  const table = [['section', 'applied', 'contradicted', 'runs', 'last applied', 'note']];
  for (const r of rows) {
    table.push([
      r.src.replace(/^[A-Z]+-/, ''), // namespace prefix off — the section is the story
      String(r.applied),
      String(r.contradicted),
      String(r.runs),
      r.last_applied ?? '—',
      r.finding ?? '',
    ]);
  }
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  for (const [i, row] of table.entries()) {
    console.log(row.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd());
    if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
  return 0;
}
