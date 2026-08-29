// The gate. Schema validation plus the static checks a schema cannot express:
// reference resolvability (decidable because capture order is lexical), matcher vocabulary,
// $users aliases against the bed config, and the weak-oracle warning.
// An invalid case is refused, never patched (RFC 0001 §2).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema.js';
import { findTokens } from './interpolate.js';
import { ANY_TYPES } from './expect.js';

const CASE_SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/case.schema.json', import.meta.url)), 'utf8'),
);
const STEP_SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/step.schema.json', import.meta.url)), 'utf8'),
);

// Deterministic code lint (RFC §4.5): a step that asserts, or reaches for anything ambient,
// is refused at the gate. Each entry: [pattern, what the refusal says].
const CODE_BANS = [
  [/\bexpect\s*\(/, 'assertion vocabulary "expect(" — assertions are declarative, always (invariant 3)'],
  [/\bassert\b/, 'assertion vocabulary "assert" — assertions are declarative, always (invariant 3)'],
  [/\.should\b/, 'assertion vocabulary ".should" — assertions are declarative, always (invariant 3)'],
  [/\brequire\s*\(/, '"require(" — a step gets its inputs and ctx helpers, nothing ambient'],
  [/\bimport\b/, '"import" — a step gets its inputs and ctx helpers, nothing ambient'],
  [/\bprocess\./, '"process." — a step gets its inputs and ctx helpers, nothing ambient'],
  [/child_process/, '"child_process" — a step gets its inputs and ctx helpers, nothing ambient'],
];

/** Validate one step definition: schema + the code lint. Returns { errors }. */
export function validateStep(stepObj) {
  const errors = validateSchema(STEP_SCHEMA, stepObj).map((e) => e.message);
  if (errors.length > 0) return { errors };
  for (const [pattern, message] of CODE_BANS) {
    if (pattern.test(stepObj.code)) errors.push(`code: refused — ${message}`);
  }
  return { errors };
}

/** Load a steps directory into a registry. Returns { steps: Map, results: [{file, id, errors}] }. */
export function loadSteps(dir) {
  const steps = new Map();
  const results = [];
  if (!dir || !existsSync(dir)) return { steps, results };
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const file = join(dir, entry);
    let stepObj;
    try {
      stepObj = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      results.push({ file, id: null, errors: [`not valid JSON — ${err.message}`] });
      continue;
    }
    const { errors } = validateStep(stepObj);
    if (stepObj?.id && steps.has(stepObj.id)) errors.push(`duplicate step id ${stepObj.id}`);
    if (errors.length === 0) steps.set(stepObj.id, stepObj);
    results.push({ file, id: stepObj?.id ?? null, errors });
  }
  return { steps, results };
}

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CAPTURE_PATH_PATTERN = /^(status|body|headers)(\.[A-Za-z0-9_-]+)*$/;

function walkMatchers(expected, path, errors) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('$any' in expected) {
      const keys = Object.keys(expected);
      if (keys.length !== 1) {
        errors.push(`${path}: a $any matcher must stand alone, found extra keys ${JSON.stringify(keys.filter((k) => k !== '$any'))}`);
      } else if (!ANY_TYPES.includes(expected.$any)) {
        errors.push(`${path}: $any must be one of ${JSON.stringify(ANY_TYPES)}, got ${JSON.stringify(expected.$any)}`);
      }
      return;
    }
    for (const [k, v] of Object.entries(expected)) walkMatchers(v, `${path}.${k}`, errors);
  } else if (Array.isArray(expected)) {
    expected.forEach((v, i) => walkMatchers(v, `${path}[${i}]`, errors));
  }
}

function checkTokens(value, where, available, errors) {
  for (const { name } of findTokens(value)) {
    if (name.startsWith('unique.')) continue;
    if (name.startsWith('users.')) {
      errors.push(`${where}: $${name} is only valid as a request's auth`);
      continue;
    }
    if (!available.has(name)) {
      errors.push(`${where}: unresolved reference $${name} — no prior capture defines it`);
    }
  }
}

function checkStep(step, label, available, bedUsers, errors, steps) {
  if ('step' in step) {
    // invocation: procedure only — the schema already refused expect/capture by shape
    const def = steps?.get(step.step);
    if (!def) {
      errors.push(`${label}.step: unknown step "${step.step}" — not in the steps registry`);
      return;
    }
    if (step.bind !== undefined) checkTokens(step.bind, `${label}.bind`, available, errors);
    for (const name of def.reads) {
      if (!(step.bind && name in step.bind) && !available.has(name)) {
        errors.push(`${label}: step ${def.id} reads "${name}" — not bound and no prior capture or step produces it`);
      }
    }
    def.produces.forEach((name) => available.add(name));
    return;
  }
  const req = step.request;
  checkTokens(req.route, `${label}.request.route`, available, errors);
  if (req.query !== undefined) checkTokens(req.query, `${label}.request.query`, available, errors);
  if (req.body !== undefined) checkTokens(req.body, `${label}.request.body`, available, errors);

  if (typeof req.auth === 'string') {
    const alias = req.auth.slice('$users.'.length);
    if (bedUsers && !(alias in bedUsers)) {
      errors.push(`${label}.request.auth: unknown bed principal "$users.${alias}" — bed config defines ${JSON.stringify(Object.keys(bedUsers))}`);
    }
  }

  for (const block of ['expect', 'pollUntil']) {
    const expectDef = block === 'expect' ? step.expect : step.pollUntil?.until;
    if (!expectDef) continue;
    const where = `${label}.${block === 'expect' ? 'expect' : 'pollUntil.until'}`;
    if ('body' in expectDef) {
      checkTokens(expectDef.body, `${where}.body`, available, errors);
      walkMatchers(expectDef.body, `${where}.body`, errors);
    }
  }

  for (const [alias, path] of Object.entries(step.capture ?? {})) {
    if (!ALIAS_PATTERN.test(alias)) errors.push(`${label}.capture: invalid alias "${alias}"`);
    if (typeof path !== 'string' || !CAPTURE_PATH_PATTERN.test(path)) {
      errors.push(`${label}.capture.${alias}: capture path must be a dotted response path (status | body.… | headers.…), got ${JSON.stringify(path)}`);
    }
    available.add(alias);
  }
}

/**
 * Validate one case. Returns { errors: string[], warnings: string[] }; valid iff errors is empty.
 * @param {object} caseObj
 * @param {{bedUsers?: object}} [opts] bed principals map, when a bed config is at hand
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
