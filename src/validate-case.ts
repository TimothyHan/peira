// The case gate. Schema validation plus the static checks a schema cannot express.
// An invalid case is refused, never patched (RFC 0001 §2).

import { validateSchema } from './schema.js';
import { CASE_SCHEMA, checkStep, type StepBlock } from './validate-core.js';
import type { Case, LoadedCase, Principal, StepDef } from './types.js';

export interface CaseValidationOptions {
  bedUsers?: Record<string, Principal> | null;
  steps?: Map<string, StepDef> | null;
  /** the cases directory; multipart fixture paths are checked against it when given (RFC 0005) */
  baseDir?: string | null;
}

export interface CaseValidationResult {
  file: string;
  id: string | undefined;
  errors: string[];
  warnings: string[];
}

/**
 * Validate one case. Returns { errors, warnings }; valid iff errors is empty.
 */
export function validateCase(caseObjIn: unknown, { bedUsers, steps, baseDir }: CaseValidationOptions = {}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const err of validateSchema(CASE_SCHEMA, caseObjIn)) {
    let message = err.message;
    if (/"sleep"/.test(message)) {
      message += ' — wall-clock sleeps are banned in cases; use pollUntil or teardown.drain';
    }
    errors.push(message);
  }
  if (errors.length > 0) return { errors, warnings }; // static checks assume a well-shaped case
  const caseObj = caseObjIn as Case;

  const available = new Set<string>();
  ((caseObj.setup ?? []) as StepBlock[]).forEach((step, i) => checkStep(step, `setup[${i}]`, available, bedUsers, errors, steps, null, warnings, baseDir));
  checkStep(caseObj.test as StepBlock, 'test', available, bedUsers, errors, steps, null, warnings, baseDir);

  // RFC 0004 O3: a hand-written case may exist before it is stamped. Its lineage is
  // incomplete, not wrong — say what to do about it instead of refusing it.
  if (caseObj.from && !caseObj.from.hash) {
    warnings.push(`unstamped: from.hash is missing — run \`peira stamp <casesDir> --intent <dir>\` to bind this case to its intent section (${caseObj.from.intent})`);
  }

  const t = caseObj.test as StepBlock;
  const asserts = (t.expect && Object.keys(t.expect).length > 0) || t.pollUntil;
  if (!asserts) {
    warnings.push('test asserts nothing — no expect and no pollUntil');
  } else if (t.expect && !('body' in t.expect) && !('bodySchema' in t.expect) && !('headers' in t.expect) && !t.pollUntil) {
    warnings.push(`weak oracle: expect checks status only (${t.expect.status ?? '?'}) with no body assertion`);
  } else if (t.expect && 'body' in t.expect && typeof t.expect.body === 'object' && t.expect.body !== null && Object.keys(t.expect.body).length === 0) {
    warnings.push('weak oracle: expect.body is an empty subset — it matches any body');
  }

  if (caseObj.teardown?.drain && available.size === 0) {
    warnings.push('teardown.drain declared but the case captures nothing to drain');
  }

  return { errors, warnings };
}

/**
 * Validate a set of loaded cases ({file, caseObj} pairs). Adds cross-case checks (duplicate ids).
 * Returns { results: [{file, id, errors, warnings}], ok }.
 */
export function validateCaseSet(loaded: LoadedCase[], opts: CaseValidationOptions = {}): { results: CaseValidationResult[]; ok: boolean } {
  const seen = new Map<string, string>();
  const results = loaded.map(({ file, caseObj }) => {
    const { errors, warnings } = validateCase(caseObj, opts);
    const id = caseObj?.id;
    if (id) {
      if (seen.has(id)) errors.push(`duplicate case id ${id} — also defined in ${seen.get(id)}`);
      else seen.set(id, file);
    }
    return { file, id, errors, warnings };
  });
  return { results, ok: results.every((r) => r.errors.length === 0) };
}
