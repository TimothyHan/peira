// Assertion semantics (RFC 0001 §4.3): subset match with Jest toMatchObject parity —
// objects match as subsets at every level, arrays match index-wise with equal length,
// primitives match strictly. Matcher vocabulary (closed, amendment A):
//   {"$any": "string" | "number" | "boolean"}  — type assertion
//   null                                        — present and exactly null

import { validateSchema } from './schema.js';

export const ANY_TYPES = ['string', 'number', 'boolean'];

function isAnyMatcher(expected) {
  return (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    Object.keys(expected).length === 1 &&
    '$any' in expected
  );
}

/**
 * Match `actual` against `expected`. Returns an array of diffs, empty when matched.
 * Each diff: { path, expected, actual, reason }.
 */
export function matchSubset(expected, actual, path = 'body') {
  if (isAnyMatcher(expected)) {
    const want = expected.$any;
    if (typeof actual !== want) {
      return [{ path, expected: `<any ${want}>`, actual, reason: `expected any ${want}, got ${actual === null ? 'null' : typeof actual}` }];
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
    return Object.entries(expected).flatMap(([key, e]) => {
      if (!(key in actual)) {
        return [{ path: `${path}.${key}`, expected: e, actual: undefined, reason: 'missing property' }];
      }
      return matchSubset(e, actual[key], `${path}.${key}`);
    });
  }
  if (expected !== actual) {
    return [{ path, expected, actual, reason: 'value mismatch' }];
  }
  return [];
}

/**
 * Evaluate an `expect` block against a response `{ status, body }`.
 * Returns an array of diffs, empty when the expectation holds.
 */
export function matchExpect(expectDef, response) {
  const diffs = [];
  if ('status' in expectDef && response.status !== expectDef.status) {
    diffs.push({ path: 'status', expected: expectDef.status, actual: response.status, reason: 'status mismatch' });
  }
  if ('body' in expectDef) {
    diffs.push(...matchSubset(expectDef.body, response.body));
  }
  if ('bodySchema' in expectDef) {
    for (const err of validateSchema(expectDef.bodySchema, response.body)) {
      diffs.push({ path: `bodySchema:${err.path || '(root)'}`, expected: err.keyword, actual: undefined, reason: err.message });
    }
  }
  return diffs;
}
