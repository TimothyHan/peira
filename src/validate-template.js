// The template gate (RFC 0001 §4.4): a case plus a holes block. The schema is DERIVED from
// the case schema (one source of truth): TPL- ids, required holes, $holes.* admitted in auth.

import { validateSchema } from './schema.js';
import { CASE_SCHEMA, ALIAS_PATTERN, HOLE_KINDS, checkStep } from './validate-core.js';

const TEMPLATE_SCHEMA = structuredClone(CASE_SCHEMA);
TEMPLATE_SCHEMA.properties.id = { type: 'string', pattern: '^TPL-[a-z0-9][a-z0-9-]*$' };
TEMPLATE_SCHEMA.required = [...TEMPLATE_SCHEMA.required, 'holes'];
TEMPLATE_SCHEMA.properties.holes = { type: 'object' };
TEMPLATE_SCHEMA.$defs.request.properties.auth.anyOf.push({ type: 'string', pattern: '^\\$holes\\.[A-Za-z0-9_]+$' });

/**
 * Validate one invariant template: derived schema, hole declarations, references.
 * Returns { errors, warnings }.
 * @param {object} tplObj
 * @param {{bedUsers?: object, steps?: Map<string, object>}} [opts]
 */
export function validateTemplate(tplObj, { bedUsers, steps } = {}) {
  const errors = validateSchema(TEMPLATE_SCHEMA, tplObj).map((e) => e.message);
  if (errors.length > 0) return { errors, warnings: [] };

  const holes = tplObj.holes;
  const seen = [];
  for (const [name, decl] of Object.entries(holes)) {
    if (!ALIAS_PATTERN.test(name)) errors.push(`holes: invalid hole name "${name}"`);
    if (decl === null || typeof decl !== 'object' || !(decl.kind in HOLE_KINDS)) {
      errors.push(`holes.${name}: kind must be one of ${Object.keys(HOLE_KINDS).join(' | ')}`);
      continue;
    }
    const extraKeys = Object.keys(decl).filter((k) => k !== 'kind' && k !== 'distinctFrom');
    if (extraKeys.length > 0) errors.push(`holes.${name}: unknown key(s) ${extraKeys.join(', ')}`);
    if (decl.distinctFrom !== undefined) {
      if (decl.kind !== 'principal') errors.push(`holes.${name}: distinctFrom applies only to principal holes`);
      else if (!seen.includes(decl.distinctFrom)) {
        errors.push(`holes.${name}: distinctFrom "${decl.distinctFrom}" must name an earlier-declared hole`);
      } else if (holes[decl.distinctFrom]?.kind !== 'principal') {
        errors.push(`holes.${name}: distinctFrom "${decl.distinctFrom}" must name a principal hole`);
      }
    }
    seen.push(name);
  }

  // distinct-groups must fit in the bed's principal pool
  if (errors.length === 0 && bedUsers) {
    const pool = Object.keys(bedUsers).length;
    const group = (name) => {
      const members = new Set([name]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [n, d] of Object.entries(holes)) {
          if (d.kind !== 'principal' || !d.distinctFrom) continue;
          if ((members.has(n) || members.has(d.distinctFrom)) && !(members.has(n) && members.has(d.distinctFrom))) {
            members.add(n);
            members.add(d.distinctFrom);
            grew = true;
          }
        }
      }
      return members.size;
    };
    for (const [name, decl] of Object.entries(holes)) {
      if (decl.kind === 'principal' && group(name) > pool) {
        errors.push(`holes.${name}: its distinct-group needs ${group(name)} principals, bed config has ${pool}`);
        break;
      }
    }
  }
  if (errors.length > 0) return { errors, warnings: [] };

  const available = new Set();
  (tplObj.setup ?? []).forEach((step, i) => checkStep(step, `setup[${i}]`, available, bedUsers, errors, steps, holes));
  checkStep(tplObj.test, 'test', available, bedUsers, errors, steps, holes);
  return { errors, warnings: [] };
}
