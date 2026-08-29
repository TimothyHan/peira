// The step gate (RFC 0001 §4.5): schema plus the deterministic code lint. A step that
// asserts, or reaches for anything ambient, is refused.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSchema, type JsonSchema } from './schema.js';
import type { StepDef } from './types.js';

const STEP_SCHEMA: JsonSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/step.schema.json', import.meta.url)), 'utf8'),
);

// Each entry: [pattern, what the refusal says].
const CODE_BANS: Array<[RegExp, string]> = [
  [/\bexpect\s*\(/, 'assertion vocabulary "expect(" — assertions are declarative, always (invariant 3)'],
  [/\bassert\b/, 'assertion vocabulary "assert" — assertions are declarative, always (invariant 3)'],
  [/\.should\b/, 'assertion vocabulary ".should" — assertions are declarative, always (invariant 3)'],
  [/\brequire\s*\(/, '"require(" — a step gets its inputs and ctx helpers, nothing ambient'],
  [/\bimport\b/, '"import" — a step gets its inputs and ctx helpers, nothing ambient'],
  [/\bprocess\./, '"process." — a step gets its inputs and ctx helpers, nothing ambient'],
  [/child_process/, '"child_process" — a step gets its inputs and ctx helpers, nothing ambient'],
];

/** Validate one step definition: schema + the code lint. Returns { errors }. */
export function validateStep(stepObj: unknown): { errors: string[] } {
  const errors = validateSchema(STEP_SCHEMA, stepObj).map((e) => e.message);
  if (errors.length > 0) return { errors };
  for (const [pattern, message] of CODE_BANS) {
    if (pattern.test((stepObj as StepDef).code)) errors.push(`code: refused — ${message}`);
  }
  return { errors };
}
