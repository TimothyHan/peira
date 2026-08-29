// The case gate. Schema validation plus the static checks a schema cannot express.
// An invalid case is refused, never patched (RFC 0001 §2).

import { validateSchema } from './schema.js';
import { CASE_SCHEMA, checkStep } from './validate-core.js';

/**
 * Validate one case. Returns { errors: string[], warnings: string[] }; valid iff errors is empty.
 * @param {object} caseObj
 * @param {{bedUsers?: object, steps?: Map<string, object>}} [opts]
 */
export function validateCase(caseObj, { bedUsers, steps } = {}) {
  const errors = [];
  const warnings = [];

  for (const err of validateSchema(CASE_SCHEMA, caseObj)) {
    let message = err.message;
    if (/"sleep"/.test(message)) {
      message += ' — wall-clock sleeps are banned in cases; use pollUntil or teardown.drain';
    }
    errors.push(message);
  }
  if (errors.length > 0) return { errors, warnings }; // static checks assume a well-shaped case

  const available = new Set();
  (caseObj.setup ?? []).forEach((step, i) => checkStep(step, `setup[${i}]`, available, bedUsers, errors, steps));
  checkStep(caseObj.test, 'test', available, bedUsers, errors, steps);

  const t = caseObj.test;
  const asserts = (t.expect && Object.keys(t.expect).length > 0) || t.pollUntil;
  if (!asserts) {
    warnings.push('test asserts nothing — no expect and no pollUntil');
  } else if (t.expect && !('body' in t.expect) && !('bodySchema' in t.expect) && !t.pollUntil) {
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
export function validateCaseSet(loaded, opts = {}) {
  const seen = new Map();
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
