// Stale detection (RFC 0001 §4.4): a case whose `from.hash` no longer matches the live intent
// text is stale — regenerable artifacts are never hand-patched into divergence. A case whose
// `from.intent` names a section that no longer exists at all is an error.

/**
 * @param {Array<{file: string, caseObj: object}>} loaded
 * @param {Array<{id: string, hash: string}>} sections live intent sections
 * @returns {{stale: Array, missing: Array}}
 */
export function checkStale(loaded, sections) {
  const live = new Map(sections.map((s) => [s.id, s.hash]));
  const stale = [];
  const missing = [];
  for (const { file, caseObj } of loaded) {
    const from = caseObj?.from;
    if (!from?.intent) continue;
    if (!live.has(from.intent)) {
      missing.push({ file, caseId: caseObj.id, intent: from.intent });
    } else if (live.get(from.intent) !== from.hash) {
      stale.push({ file, caseId: caseObj.id, intent: from.intent, caseHash: from.hash, liveHash: live.get(from.intent) });
    }
  }
  return { stale, missing };
}
