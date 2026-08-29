// Peira's error taxonomy, in one place. The classes carry verdict semantics (RFC §4.7):
// CaseFailure → verdict `fail` (an assertion or a generated artifact's contract did not hold);
// InfraError → verdict `error` (infrastructure failed before any assertion could);
// the rest are tool-side failures that never masquerade as verdicts.

import type { Diff } from './types.js';

/** An assertion did not hold, or a generated artifact broke its contract → verdict `fail`. */
export class CaseFailure extends Error {
  diffs: Diff[];
  constructor(reason: string, diffs: Diff[] = []) {
    super(reason);
    this.name = 'CaseFailure';
    this.diffs = diffs;
  }
}

/** Infrastructure failed before an assertion could be evaluated → verdict `error`. */
export class InfraError extends Error {
  override cause: unknown;
  /** set by the step harness so the parent can classify across the process boundary */
  isInfra = true;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'InfraError';
    this.cause = cause;
  }
}

/** The model-facing transport (claude CLI) failed — a tool failure, never a verdict. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/** A `$name` / `{{name}}` reference could not be resolved. */
export class UnresolvedTokenError extends Error {
  token: string;
  constructor(token: string) {
    super(`unresolved reference: ${token}`);
    this.name = 'UnresolvedTokenError';
    this.token = token;
  }
}
