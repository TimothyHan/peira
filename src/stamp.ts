// Zero-LLM lineage binding (RFC 0003 P1). A case's `from.intent` is authored by a human; its
// `from.hash` never is — compile stamps it mechanically, and this is the same stamp for cases
// no model wrote. `planStamp` is the write-side of checkStale: it names every case whose hash
// is missing or no longer matches the live section, and `applyStamp` rewrites exactly those
// files, in the format compile writes, touching nothing else in them.

import { writeFileSync } from 'node:fs';
import type { LoadedCase } from './types.js';

export interface StampChange {
  file: string;
  caseId: string;
  intent: string;
  /** undefined when the case had no hash yet */
  from: string | undefined;
  to: string;
}

export interface StampPlan {
  changes: StampChange[];
  /** cases whose from.intent names no live section — an error, never silently skipped */
  missing: Array<{ file: string; caseId: string; intent: string }>;
  /** cases with no from.intent at all: nothing to bind to */
  unbound: number;
  /** cases already carrying the live hash */
  current: number;
}

export function planStamp(loaded: LoadedCase[], sections: Array<{ id: string; hash: string }>): StampPlan {
  const live = new Map(sections.map((s) => [s.id, s.hash]));
  const plan: StampPlan = { changes: [], missing: [], unbound: 0, current: 0 };
  for (const { file, caseObj } of loaded) {
    const intent = caseObj?.from?.intent;
    if (!intent) {
      plan.unbound += 1;
      continue;
    }
    const to = live.get(intent);
    if (to === undefined) {
      plan.missing.push({ file, caseId: caseObj.id, intent });
      continue;
    }
    const from = caseObj.from.hash;
    if (from === to) plan.current += 1;
    else plan.changes.push({ file, caseId: caseObj.id, intent, from, to });
  }
  return plan;
}

/** Rewrite each changed case with its live hash. Key order is preserved; intent is untouched. */
export function applyStamp(plan: StampPlan, loaded: LoadedCase[]): void {
  const byFile = new Map(loaded.map((l) => [l.file, l.caseObj]));
  for (const change of plan.changes) {
    const caseObj = byFile.get(change.file)!;
    caseObj.from = { ...caseObj.from, hash: change.to };
    writeFileSync(change.file, JSON.stringify(caseObj, null, 2) + '\n');
  }
}
