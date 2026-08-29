// The Akela seam (RFC 0001 §4.8). Peira keeps its own flat evidence log and does NOT depend
// on Akela — this module just reshapes a run (+ its triage adjudications) into the
// applied/contradicted grammar both engines will eventually share:
//
//   a passing case APPLIES its intent section
//   a triaged bug CONTRADICTS the service
//   a triaged drift CONTRADICTS the case (the encoded expectation, not the intent)
//
// `error` verdicts, untriaged failures, and flake adjudications export NOTHING — unadjudicated
// signal never becomes evidence (D4; Akela's own gate ethos applied to ourselves).
// Pure function of its inputs: same run + same proposals → byte-identical output.

import { parseEvidence, routeVerdicts } from './triage.js';

/**
 * @param {string} runEvidenceText run JSONL
 * @param {object|null} triageProposals parsed proposals (peira triage output), or null
 * @returns {object[]} applied/contradicted records, in verdict order
 */
export function deriveAkelaEvidence(runEvidenceText, triageProposals = null) {
  const { seed, verdicts, definitions } = parseEvidence(runEvidenceText);
  if (triageProposals && triageProposals.seed !== seed) {
    throw new Error(`triage proposals are for seed ${triageProposals.seed}, run evidence is seed ${seed} — refusing to mix runs`);
  }
  const adjudications = new Map((triageProposals?.verdicts ?? []).map((v) => [v.case, v.classification]));
  const { failures } = routeVerdicts(verdicts);
  const failureIds = new Set(failures.map((f) => f.id));

  const records = [];
  for (const v of verdicts) {
    const def = definitions.get(v.id);
    const from = def?.from;
    if (!from?.intent) continue; // no lineage, no evidence
    const lineage = {
      intent: from.intent,
      hash: from.hash,
      case: v.id,
      seed,
      ...(from.template !== undefined ? { template: from.template, instance: from.instance } : {}),
    };
    if (v.verdict === 'pass') {
      records.push({ event: 'applied', ...lineage });
    } else if (failureIds.has(v.id)) {
      const adjudication = adjudications.get(v.id);
      if (adjudication === 'bug') records.push({ event: 'contradicted', subject: 'service', ...lineage, via: 'triage:bug' });
      else if (adjudication === 'drift') records.push({ event: 'contradicted', subject: 'case', ...lineage, via: 'triage:drift' });
      // flake or untriaged: nothing — insufficient or unadjudicated evidence is not evidence
    }
    // error verdicts: nothing, by construction
  }
  return records;
}
