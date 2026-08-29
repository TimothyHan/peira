// Peira's error taxonomy, in one place. The classes carry verdict semantics (RFC §4.7):
// CaseFailure → verdict `fail` (an assertion or a generated artifact's contract did not hold);
// InfraError → verdict `error` (infrastructure failed before any assertion could);
// the rest are tool-side failures that never masquerade as verdicts.

/** An assertion did not hold, or a generated artifact broke its contract → verdict `fail`. */
export class CaseFailure extends Error {
  constructor(reason, diffs = []) {
    super(reason);
    this.name = 'CaseFailure';
    this.diffs = diffs;
  }
}

/** Infrastructure failed before an assertion could be evaluated → verdict `error`. */
export class InfraError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'InfraError';
    this.cause = cause;
    /** set by the step harness so the parent can classify across the process boundary */
    this.isInfra = true;
  }
}

/** The model-facing transport (claude CLI) failed — a tool failure, never a verdict. */
export class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransportError';
  }
}

/** A `$name` / `{{name}}` reference could not be resolved. */
export class UnresolvedTokenError extends Error {
  constructor(token) {
    super(`unresolved reference: ${token}`);
    this.name = 'UnresolvedTokenError';
    this.token = token;
  }
}
