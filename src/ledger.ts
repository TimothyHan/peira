// The evidence-ledger mapping (RFC 0001 §4.8, revised 2026-08-29 on adoption of the real engine).
// The ledger asks exactly one question per intent section: was this knowledge right?
//
//   pass          → applied      (the intent section proved valid)
//   triaged bug   → applied      (the section did its job: it correctly predicted what should
//                                 happen and caught the service violating it — the defect is a
//                                 Peira finding, the knowledge earned trust)
//   triaged drift → contradicted (reality contradicted the intent text — trust drops, the
//                                 author amends; the note carries the adjudication verbatim)
//   flake / error / untriaged → nothing (unadjudicated signal never becomes evidence)
//
// Two views: per-case records (the exported JSONL, self-contained), and per-SECTION evidence
// (deduped — at most one applied per section per run, contradiction dominating a mixed section)
// sized for the ledger's promotion arithmetic, which counts runs, not cases.

import { parseEvidence, routeVerdicts, type TriageProposals } from './triage.js';
import type { IntentSection } from './intent.js';

export interface LedgerRecord {
  event: 'applied' | 'contradicted';
  via: 'pass' | 'triage:bug' | 'triage:drift';
  intent: string;
  hash: string;
  case: string;
  seed: number | null;
  template?: string;
  instance?: number;
  note?: string;
}

/** Per-case evidence records (the exported JSONL). */
export function deriveLedgerEvidence(runEvidenceText: string, triageProposals: TriageProposals | null = null): LedgerRecord[] {
  const { seed, verdicts, definitions } = parseEvidence(runEvidenceText);
  if (triageProposals && triageProposals.seed !== seed) {
    throw new Error(`triage proposals are for seed ${triageProposals.seed}, run evidence is seed ${seed} — refusing to mix runs`);
  }
  const adjudications = new Map((triageProposals?.verdicts ?? []).map((v) => [v.case, v]));
  const { failures } = routeVerdicts(verdicts);
  const failureIds = new Set(failures.map((f) => f.id));

  const records: LedgerRecord[] = [];
  for (const v of verdicts) {
    const from = definitions.get(v.id)?.from;
    if (!from?.intent) continue; // no lineage, no evidence
    const lineage = {
      intent: from.intent,
      hash: from.hash,
      case: v.id,
      seed,
      ...(from.template !== undefined ? { template: from.template, instance: from.instance } : {}),
    };
    if (v.verdict === 'pass') {
      records.push({ event: 'applied', via: 'pass', ...lineage });
    } else if (failureIds.has(v.id)) {
      const adjudication = adjudications.get(v.id);
      if (adjudication?.classification === 'bug') {
        records.push({ event: 'applied', via: 'triage:bug', ...lineage });
      } else if (adjudication?.classification === 'drift') {
        records.push({ event: 'contradicted', via: 'triage:drift', ...lineage, note: adjudication.rationale });
      }
      // flake or untriaged: nothing
    }
    // error verdicts: nothing, by construction
  }
  return records;
}

/**
 * Collapse per-case records into per-section evidence for a ledger run: at most one event per
 * section, contradiction dominating a mixed section (the note says why). Section ids map to
 * ledger source ids (`PEIRA-<file-stem>#<id>`) via the live intent sections.
 * @param {object[]} records from deriveLedgerEvidence
 * @param {Array<{id: string, file: string}>} sections from loadIntentDir
 * @param {string} [namespace]
 */
export interface SectionEvidence {
  applied: string[];
  contradicted: Array<{ src: string; note: string }>;
  unmapped: string[];
}

export function sectionEvidence(records: LedgerRecord[], sections: Array<Pick<IntentSection, 'id' | 'file'>>, namespace = 'PEIRA'): SectionEvidence {
  const srcFor = new Map(sections.map((s) => [s.id, `${namespace}-${(s.file ?? '').replace(/\.md$/, '')}#${s.id}`]));
  const bySection = new Map<string, LedgerRecord[]>();
  const unmapped = new Set<string>();
  for (const r of records) {
    if (!srcFor.has(r.intent)) {
      unmapped.add(r.intent);
      continue;
    }
    if (!bySection.has(r.intent)) bySection.set(r.intent, []);
    bySection.get(r.intent)!.push(r);
  }
  const applied: string[] = [];
  const contradicted: Array<{ src: string; note: string }> = [];
  for (const [intent, events] of bySection) {
    const src = srcFor.get(intent)!;
    const drift = events.find((e) => e.event === 'contradicted');
    if (drift) {
      contradicted.push({ src, note: drift.note ?? `drift adjudicated on ${drift.case}` });
    } else {
      applied.push(src);
    }
  }
  return { applied: applied.sort(), contradicted: contradicted.sort((a, b) => a.src.localeCompare(b.src)), unmapped: [...unmapped].sort() };
}
