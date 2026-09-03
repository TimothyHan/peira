// Stale detection (RFC 0001 §4.4): a case whose `from.hash` no longer matches the live intent
// text is stale — regenerable artifacts are never hand-patched into divergence. A case whose
// `from.intent` names a section that no longer exists at all is an error.

import type { LoadedCase } from './types.js';

export interface StaleCase {
  file: string;
  caseId: string;
  intent: string;
  caseHash: string;
  liveHash: string;
}

export interface MissingIntentCase {
  file: string;
  caseId: string;
  intent: string;
}

/** A case with from.intent but no from.hash yet — hand-written, awaiting `peira stamp`. */
export interface UnstampedCase {
  file: string;
  caseId: string;
  intent: string;
}

export function checkStale(
  loaded: LoadedCase[],
  sections: Array<{ id: string; hash: string }>,
): { stale: StaleCase[]; missing: MissingIntentCase[]; unstamped: UnstampedCase[] } {
  const live = new Map(sections.map((s) => [s.id, s.hash]));
  const stale: StaleCase[] = [];
  const missing: MissingIntentCase[] = [];
  const unstamped: UnstampedCase[] = [];
  for (const { file, caseObj } of loaded) {
    const from = caseObj?.from;
    if (!from?.intent) continue;
    if (!live.has(from.intent)) {
      missing.push({ file, caseId: caseObj.id, intent: from.intent });
    } else if (!from.hash) {
      unstamped.push({ file, caseId: caseObj.id, intent: from.intent }); // RFC 0004 O3 — not stale: never stamped
    } else if (live.get(from.intent) !== from.hash) {
      stale.push({ file, caseId: caseObj.id, intent: from.intent, caseHash: from.hash, liveHash: live.get(from.intent)! });
    }
  }
  return { stale, missing, unstamped };
}
