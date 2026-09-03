// Assertion semantics (RFC 0001 §4.3): subset match with Jest toMatchObject parity —
// objects match as subsets at every level, arrays match index-wise with equal length,
// primitives match strictly. Matcher vocabulary (closed, amendments A and D):
//   {"$any": "string" | "number" | "boolean"}  — type assertion
//   {"$contains": "<substring>"}                — string containing the substring
//   {"$absent": true}                           — the key (or header) must NOT exist (amendment G)
//   null                                        — present and exactly null

import { validateSchema } from './schema.js';
import type { Diff } from './types.js';

export const ANY_TYPES = ['string', 'number', 'boolean'];

function isSoleKeyMatcher(expected: unknown, key: string): boolean {
  return (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    Object.keys(expected).length === 1 &&
    key in expected
  );
}

function isAnyMatcher(expected: unknown): expected is { $any: string } {
  return isSoleKeyMatcher(expected, '$any');
}

function isContainsMatcher(expected: unknown): expected is { $contains: string } {
  return isSoleKeyMatcher(expected, '$contains');
}

/** Subset matching can only say what IS there; this is the one way to say what must not be. */
export function isAbsentMatcher(expected: unknown): expected is { $absent: true } {
  return isSoleKeyMatcher(expected, '$absent');
}

/**
 * Match `actual` against `expected`. Returns an array of diffs, empty when matched.
 */
export function matchSubset(expected: unknown, actual: unknown, path = 'body'): Diff[] {
  if (isAnyMatcher(expected)) {
    const want = expected.$any;
    if (typeof actual !== want) {
      return [{ path, expected: `<any ${want}>`, actual, reason: `expected any ${want}, got ${actual === null ? 'null' : typeof actual}` }];
    }
    return [];
  }
  if (isContainsMatcher(expected)) {
    const want = expected.$contains;
    if (typeof actual !== 'string' || !actual.includes(want)) {
      return [{ path, expected: `<contains ${JSON.stringify(want)}>`, actual, reason: `expected a string containing ${JSON.stringify(want)}` }];
    }
    return [];
  }
  if (expected === null) {
    return actual === null ? [] : [{ path, expected: null, actual, reason: 'expected null' }];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [{ path, expected, actual, reason: 'expected an array' }];
    }
    if (actual.length !== expected.length) {
      return [{ path, expected: `array[${expected.length}]`, actual: `array[${actual.length}]`, reason: 'array length mismatch' }];
    }
    return expected.flatMap((e, i) => matchSubset(e, actual[i], `${path}[${i}]`));
  }
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return [{ path, expected, actual, reason: 'expected an object' }];
    }
    const actualObj = actual as Record<string, unknown>;
    return Object.entries(expected).flatMap(([key, e]) => {
      if (isAbsentMatcher(e)) {
        // distinct from null: null asserts presence with a null value; $absent asserts no key at all
        return key in actualObj ? [{ path: `${path}.${key}`, expected: '<absent>', actual: actualObj[key], reason: 'expected absent, but present' }] : [];
      }
      if (!(key in actualObj)) {
        return [{ path: `${path}.${key}`, expected: e, actual: undefined, reason: 'missing property' }];
      }
      return matchSubset(e, actualObj[key], `${path}.${key}`);
    });
  }
  if (expected !== actual) {
    return [{ path, expected, actual, reason: 'value mismatch' }];
  }
  return [];
}

export interface ExpectDef {
  status?: number;
  /** response-header assertions; names are matched case-insensitively */
  headers?: Record<string, unknown>;
  body?: unknown;
  bodySchema?: Record<string, unknown>;
}

/**
 * Evaluate an `expect` block against a response `{ status, headers, body }`.
 * Returns an array of diffs, empty when the expectation holds.
 */
export function matchExpect(expectDef: ExpectDef, response: { status: number; headers?: Record<string, string>; body: unknown }): Diff[] {
  const diffs: Diff[] = [];
  if ('status' in expectDef && response.status !== expectDef.status) {
    diffs.push({ path: 'status', expected: expectDef.status, actual: response.status, reason: 'status mismatch' });
  }
  if ('headers' in expectDef && expectDef.headers) {
    // HTTP header names are case-insensitive (RFC 9110 §5.1) — normalize both sides
    const actualHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers ?? {})) actualHeaders[k.toLowerCase()] = v;
    for (const [name, expected] of Object.entries(expectDef.headers)) {
      const lower = name.toLowerCase();
      if (isAbsentMatcher(expected)) {
        if (lower in actualHeaders) diffs.push({ path: `headers.${lower}`, expected: '<absent>', actual: actualHeaders[lower], reason: 'expected absent, but present' });
      } else if (!(lower in actualHeaders)) {
        diffs.push({ path: `headers.${lower}`, expected, actual: undefined, reason: 'missing header' });
      } else {
        diffs.push(...matchSubset(expected, actualHeaders[lower], `headers.${lower}`));
      }
    }
  }
  if ('body' in expectDef) {
    diffs.push(...matchSubset(expectDef.body, response.body));
  }
  if ('bodySchema' in expectDef && expectDef.bodySchema) {
    for (const err of validateSchema(expectDef.bodySchema, response.body)) {
      diffs.push({ path: `bodySchema:${err.path || '(root)'}`, expected: err.keyword, actual: undefined, reason: err.message });
    }
  }
  return diffs;
}
