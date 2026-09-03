// Shared internals of the three validators (case, step, template): schema loading, reference
// checking, matcher walking, and the per-step static checks. Not part of the public API —
// import from validate.js (the barrel) instead.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSchema, type JsonSchema } from './schema.js';
import { findTokens } from './interpolate.js';
import { ANY_TYPES } from './expect.js';
import type { HoleDecl, Principal, StepDef } from './types.js';

export const CASE_SCHEMA: JsonSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/case.schema.json', import.meta.url)), 'utf8'),
);

export const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CAPTURE_PATH_PATTERN = /^(status|body|headers)(\.[A-Za-z0-9_-]+)*$/;

// Hole vocabulary — closed, v1 (RFC PR4 D3). attrs: which sub-references a hole admits.
export const HOLE_KINDS: Record<string, { attrs: string[]; attrRequired?: boolean }> = {
  principal: { attrs: [] },
  expression: { attrs: ['code', 'result'], attrRequired: true },
  unique: { attrs: [] },
};

/** A step block inside a case: a request step or a registry-step invocation. Untrusted shape. */
export type StepBlock = Record<string, any>;

export function walkMatchers(expected: unknown, path: string, errors: string[]): void {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const obj = expected as Record<string, unknown>;
    if ('$any' in obj) {
      const keys = Object.keys(obj);
      if (keys.length !== 1) {
        errors.push(`${path}: a $any matcher must stand alone, found extra keys ${JSON.stringify(keys.filter((k) => k !== '$any'))}`);
      } else if (!ANY_TYPES.includes(obj.$any as string)) {
        errors.push(`${path}: $any must be one of ${JSON.stringify(ANY_TYPES)}, got ${JSON.stringify(obj.$any)}`);
      }
      return;
    }
    for (const key of ['$contains', '$notContains'] as const) {
      if (key in obj) {
        const keys = Object.keys(obj);
        const v = obj[key];
        const okList = Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
        if (keys.length !== 1) {
          errors.push(`${path}: a ${key} matcher must stand alone, found extra keys ${JSON.stringify(keys.filter((k) => k !== key))}`);
        } else if (typeof v !== 'string' && !okList) {
          errors.push(`${path}: ${key} takes a string or a non-empty array of strings, got ${JSON.stringify(v)}`);
        }
        return;
      }
    }
    if ('$absent' in obj) {
      const keys = Object.keys(obj);
      if (keys.length !== 1) {
        errors.push(`${path}: an $absent matcher must stand alone, found extra keys ${JSON.stringify(keys.filter((k) => k !== '$absent'))}`);
      } else if (obj.$absent !== true) {
        errors.push(`${path}: $absent takes exactly true, got ${JSON.stringify(obj.$absent)}`);
      }
      return;
    }
    for (const [k, v] of Object.entries(obj)) walkMatchers(v, `${path}.${k}`, errors);
  } else if (Array.isArray(expected)) {
    expected.forEach((v, i) => walkMatchers(v, `${path}[${i}]`, errors));
  }
}

export function checkTokens(
  value: unknown,
  where: string,
  available: Set<string>,
  errors: string[],
  holes?: Record<string, HoleDecl> | null,
): void {
  for (const { name } of findTokens(value)) {
    if (name.startsWith('unique.')) continue;
    if (name.startsWith('users.')) {
      errors.push(`${where}: $${name} is only valid as a request's auth`);
      continue;
    }
    if (name.startsWith('holes.')) {
      if (!holes) {
        errors.push(`${where}: $${name} — hole references are only valid in templates`);
        continue;
      }
      const [, holeName, attr, extra] = name.split('.');
      const decl = holes[holeName];
      if (!decl || extra !== undefined) {
        errors.push(`${where}: $${name} — no such hole${decl ? ' attribute' : ''}; declared: ${Object.keys(holes).join(', ')}`);
        continue;
      }
      const rules = HOLE_KINDS[decl.kind];
      if (attr !== undefined && !rules.attrs.includes(attr)) {
        errors.push(`${where}: $${name} — a ${decl.kind} hole has no attribute "${attr}"${rules.attrs.length ? ` (has: ${rules.attrs.join(', ')})` : ''}`);
      } else if (attr === undefined && rules.attrRequired) {
        errors.push(`${where}: $holes.${holeName} — a ${decl.kind} hole must be referenced by attribute (${rules.attrs.join(' | ')})`);
      }
      continue;
    }
    if (!available.has(name)) {
      errors.push(`${where}: unresolved reference $${name} — no prior capture defines it`);
    }
  }
}

/**
 * A `$name` inside a longer string resolves to the literal text — only "{{name}}" splices. The
 * first thing a new user writes is "/api/news/$theirs", and nothing else would say a word
 * (RFC 0003 P4a). A warning, not an error: "$" can start ordinary text too.
 */
const EMBEDDED_REF = /\$([A-Za-z_][A-Za-z0-9_.]*)/g;
export function warnEmbeddedRefs(value: unknown, where: string, warnings: string[]): void {
  if (typeof value === 'string') {
    if (/^\$[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) return; // whole-value form: fine
    for (const m of value.matchAll(EMBEDDED_REF)) {
      warnings.push(`${where}: "${value}" contains $${m[1]} inside a longer string — that resolves to the literal text; inside a string use {{${m[1]}}}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => warnEmbeddedRefs(v, `${where}[${i}]`, warnings));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) warnEmbeddedRefs(v, `${where}.${k}`, warnings);
  }
}

export function checkStep(
  step: StepBlock,
  label: string,
  available: Set<string>,
  bedUsers: Record<string, Principal> | null | undefined,
  errors: string[],
  steps?: Map<string, StepDef> | null,
  holes?: Record<string, HoleDecl> | null,
  warnings?: string[],
): void {
  if ('step' in step) {
    // invocation: procedure only — the schema already refused expect/capture by shape
    const def = steps?.get(step.step);
    if (!def) {
      errors.push(`${label}.step: unknown step "${step.step}" — not in the steps registry`);
      return;
    }
    if (step.bind !== undefined) checkTokens(step.bind, `${label}.bind`, available, errors, holes);
    for (const name of def.reads) {
      if (!(step.bind && name in step.bind) && !available.has(name)) {
        errors.push(`${label}: step ${def.id} reads "${name}" — not bound and no prior capture or step produces it`);
      }
    }
    def.produces.forEach((name) => available.add(name));
    return;
  }
  const req = step.request;
  checkTokens(req.route, `${label}.request.route`, available, errors, holes);
  if (req.query !== undefined) checkTokens(req.query, `${label}.request.query`, available, errors, holes);
  if (req.body !== undefined) checkTokens(req.body, `${label}.request.body`, available, errors, holes);
  if (warnings) {
    warnEmbeddedRefs(req.route, `${label}.request.route`, warnings);
    if (req.query !== undefined) warnEmbeddedRefs(req.query, `${label}.request.query`, warnings);
    if (req.body !== undefined) warnEmbeddedRefs(req.body, `${label}.request.body`, warnings);
  }

  if (typeof req.auth === 'string' && req.auth.startsWith('$holes.')) {
    const holeName = req.auth.slice('$holes.'.length);
    if (!holes) errors.push(`${label}.request.auth: "${req.auth}" — hole references are only valid in templates`);
    else if (holes[holeName]?.kind !== 'principal') {
      errors.push(`${label}.request.auth: "${req.auth}" must name a principal hole`);
    }
  } else if (typeof req.auth === 'string') {
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
      const b = expectDef.body;
      if (b !== null && typeof b === 'object' && !Array.isArray(b) && '$absent' in b) {
        errors.push(`${where}.body: $absent applies to a key or a header, not the whole body — there is nothing for the body to be absent from`);
      }
      checkTokens(expectDef.body, `${where}.body`, available, errors, holes);
      walkMatchers(expectDef.body, `${where}.body`, errors);
    }
    if ('headers' in expectDef) {
      checkTokens(expectDef.headers, `${where}.headers`, available, errors, holes);
      walkMatchers(expectDef.headers, `${where}.headers`, errors);
      // headers are strings on the wire: a value is a literal string or a matcher, nothing else
      for (const [name, value] of Object.entries((expectDef.headers ?? {}) as Record<string, unknown>)) {
        const isMatcher = value !== null && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).length === 1 && ('$any' in value || '$contains' in value || '$notContains' in value || '$absent' in value);
        if (typeof value !== 'string' && !isMatcher) {
          errors.push(`${where}.headers.${name}: a header value is a literal string or a $any/$contains/$notContains/$absent matcher, got ${JSON.stringify(value)}`);
        }
      }
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
