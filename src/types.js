// Central JSDoc typedefs for the public API — this is what `npm run build:types` turns into
// the shipped .d.ts surface. No runtime code.

/** @typedef {'pass' | 'fail' | 'error'} VerdictKind */

/** @typedef {{path: string, expected: *, actual: *, reason: string}} Diff */

/** @typedef {{id: string, verdict: VerdictKind, reason?: string, diffs?: Diff[]}} Verdict */

/** @typedef {{username: string, password: string}} Principal */

/**
 * @typedef {object} BedConfig
 * @property {string} [baseUrl]
 * @property {Record<string, Principal>} [users]
 * @property {{route: string, idParam: string, statusPath: string, terminal: string[]}} [drain]
 * @property {{url: string, method?: string}} [reset]
 */

/**
 * A declarative test case (schema/case.schema.json is the authority; this type is a loose
 * structural mirror for editor support).
 * @typedef {object} Case
 * @property {string} id
 * @property {string} [title]
 * @property {string} [notes]
 * @property {{intent: string, hash: string, template?: string, seed?: number, instance?: number}} from
 * @property {object[]} [setup]
 * @property {object} test
 * @property {{drain: true}} [teardown]
 */

/** @typedef {{file: string, caseObj: Case}} LoadedCase */

/** @typedef {{pass: number, fail: number, error: number}} VerdictCounts */

/**
 * @typedef {object} RunResult
 * @property {number} seed
 * @property {Verdict[]} verdicts
 * @property {VerdictCounts} counts
 * @property {object[]} events redacted evidence events (also written to evidencePath when set)
 */

export {};
