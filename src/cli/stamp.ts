// `peira stamp` — bind hand-written cases to their intent without a model (RFC 0003 P1).
// Read-only under --check, where it is the model-free CI gate for lineage: exit 1 if any case
// would change. validate --intent only WARNS on a stale case; this is the version that fails.

import { loadCases } from '../load.js';
import { loadIntentDir } from '../intent.js';
import { planStamp, applyStamp } from '../stamp.js';
import type { CliContext } from './context.js';

export async function main(ctx: CliContext): Promise<number> {
  const { flags, casesDir } = ctx;
  if (!flags.intent) {
    console.error('usage: peira stamp [casesDir] --intent <dir> [--check]');
    return 2;
  }
  const { loaded, parseErrors } = loadCases(casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  if (parseErrors.length > 0) return 1;

  const sections = loadIntentDir(flags.intent);
  const plan = planStamp(loaded, sections);

  for (const m of plan.missing) {
    console.error(`ERROR ${m.file}: ${m.caseId} — intent section "${m.intent}" does not exist; from.intent is yours to fix, from.hash is not`);
  }
  const verb = flags.check ? 'would stamp' : 'stamped';
  for (const c of plan.changes) {
    console.log(`${verb} ${c.file}: ${c.caseId} ← ${c.intent} @ ${c.to}${c.from ? ` (was ${c.from})` : ' (no hash yet)'}`);
  }
  const summary = `${plan.changes.length} to stamp, ${plan.current} current, ${plan.unbound} without from.intent${plan.missing.length ? `, ${plan.missing.length} missing` : ''}`;

  if (flags.check) {
    console.log(summary);
    return plan.missing.length > 0 || plan.changes.length > 0 ? 1 : 0;
  }
  if (plan.missing.length > 0) {
    console.error(`${summary} — refused: fix the missing intent references first`);
    return 1;
  }
  applyStamp(plan, loaded);
  console.log(summary);
  return 0;
}
