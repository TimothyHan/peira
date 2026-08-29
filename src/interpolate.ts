// Reference resolution (RFC 0001 §4.3 amendment C).
// Two forms, one namespace grammar:
//   - whole-value: a string that IS "$name" resolves to the referenced value, type-preserving
//   - in-string:   "{{name}}" splices String(value) anywhere inside a string, at any depth
//   - escape:      "{{{{" yields a literal "{{"
// Names: a capture alias ("requestId"), or "unique.<key>" (seed-derived). "$users.<alias>" is
// legal ONLY in a request's auth position and is resolved by the runner, never spliced into data.

const WHOLE_VALUE = /^\$([A-Za-z_][A-Za-z0-9_.]*)$/;
const IN_STRING = /\{\{([A-Za-z_][A-Za-z0-9_.]*)\}\}/g;
const ESCAPE_SENTINEL = ' PEIRA_ESC ';

import { UnresolvedTokenError } from './errors.js';
export { UnresolvedTokenError };

export interface ResolveContext {
  captures: Record<string, unknown>;
  unique: (key: string) => unknown;
}

export interface TokenRef {
  name: string;
  form: 'whole' | 'inline';
}

function lookup(name: string, ctx: ResolveContext): unknown {
  if (name.startsWith('unique.')) return ctx.unique(name.slice('unique.'.length));
  if (name.startsWith('users.')) throw new UnresolvedTokenError(`$${name} (only valid as a request's auth)`);
  if (name in ctx.captures) return ctx.captures[name];
  throw new UnresolvedTokenError(`$${name}`);
}

/**
 * Deep-resolve every reference in `value` against `ctx = { captures, unique(key) }`.
 * Returns a new structure; never mutates the input.
 */
export function resolveValue(value: unknown, ctx: ResolveContext): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_VALUE);
    if (whole) return lookup(whole[1], ctx);
    const protectedStr = value.replaceAll('{{{{', ESCAPE_SENTINEL);
    const resolved = protectedStr.replace(IN_STRING, (_, name: string) => String(lookup(name, ctx)));
    return resolved.replaceAll(ESCAPE_SENTINEL, '{{');
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]));
  }
  return value;
}

/**
 * Enumerate every reference in `value` without resolving. For static validation.
 */
export function findTokens(value: unknown, out: TokenRef[] = []): TokenRef[] {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_VALUE);
    if (whole) {
      out.push({ name: whole[1], form: 'whole' });
    } else {
      const protectedStr = value.replaceAll('{{{{', ESCAPE_SENTINEL);
      for (const m of protectedStr.matchAll(IN_STRING)) out.push({ name: m[1], form: 'inline' });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => findTokens(v, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((v) => findTokens(v, out));
  }
  return out;
}
