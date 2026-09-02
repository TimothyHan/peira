// Central type definitions for the public API — this is the shipped .d.ts surface.
// No runtime code.

export type VerdictKind = 'pass' | 'fail' | 'error';

export interface Diff {
  path: string;
  expected: unknown;
  actual: unknown;
  reason: string;
}

export interface Verdict {
  id: string;
  verdict: VerdictKind;
  reason?: string;
  diffs?: Diff[];
  /** wall-clock case duration; informational — never part of a verdict's meaning */
  elapsedMs?: number;
}

/** HTTP Basic: the original principal shape. */
export interface BasicPrincipal {
  username: string;
  password: string;
}

/**
 * How a token is attached to every request made as this principal (RFC 0002 §3.2). Exactly one
 * of the two forms; `format` must contain `{{token}}`.
 */
export type TokenSend = { header: string; format: string; cookie?: never } | { cookie: string; header?: never; format?: never };

/** A principal that logs in once per run and sends the resulting token (RFC 0002 §3.1). */
export interface LoginPrincipal {
  login: {
    /** lowercase HTTP method; default post */
    method?: string;
    route: string;
    body?: unknown;
    /** capture path into the login response, e.g. body.token */
    token: string;
    send: TokenSend;
  };
}

/** A principal with a fixed token and no login step — API keys (RFC 0002 §3.1). */
export interface StaticTokenPrincipal {
  token: string;
  send: TokenSend;
}

/** A bed principal: Basic, login, or static token. A bed alias is exactly one of these. */
export type Principal = BasicPrincipal | LoginPrincipal | StaticTokenPrincipal;

export interface BedConfig {
  baseUrl?: string;
  users?: Record<string, Principal>;
  drain?: { route: string; idParam: string; statusPath: string; terminal: string[] };
  reset?: { url: string; method?: string };
  /**
   * The service's latency envelope — timeout CEILINGS only (environment description, not tool
   * tuning; invariant 7 carve-out). The poll interval stays a pinned constant: it carries the
   * determinism claim for transient-state assertions (invariant 8).
   */
  timeouts?: { requestMs?: number; pollUntilMs?: number; drainMs?: number; stepMs?: number };
  /**
   * How to start the service under test (`peira run` only; read-only commands never spawn).
   * With reuse (default true) an already-answering baseUrl is used as-is and never killed;
   * a server Peira started is killed — whole process group — when the run ends.
   */
  service?: { command: string; cwd?: string; readyMs?: number; reuse?: boolean };
}

/** Case lineage: which intent section (at which hash) this case was compiled from. */
export interface CaseLineage {
  intent: string;
  hash: string;
  template?: string;
  seed?: number;
  instance?: number;
}

/**
 * A declarative test case (schema/case.schema.json is the authority; this type is a loose
 * structural mirror for editor support).
 */
export interface Case {
  id: string;
  title?: string;
  notes?: string;
  from: CaseLineage;
  setup?: Record<string, unknown>[];
  test: Record<string, unknown>;
  teardown?: { drain: true };
  [key: string]: unknown;
}

export interface LoadedCase {
  file: string;
  caseObj: Case;
}

export interface VerdictCounts {
  pass: number;
  fail: number;
  error: number;
}

/** An escape-hatch step definition (schema/step.schema.json is the authority). */
export interface StepDef {
  id: string;
  reads: string[];
  produces: string[];
  code: string;
  [key: string]: unknown;
}

export type HoleDecl =
  | { kind: 'principal'; distinctFrom?: string }
  | { kind: 'expression' }
  | { kind: 'unique' };

/** An invariant template: a case shape with declared holes, minted per run. */
export interface Template {
  id: string;
  holes: Record<string, HoleDecl>;
  from: CaseLineage;
  [key: string]: unknown;
}

export interface RunResult {
  seed: number;
  verdicts: Verdict[];
  counts: VerdictCounts;
  /** run span in wall-clock ms */
  wallMs: number;
  /** sum of every logged HTTP exchange's elapsedMs (a total, not a partition of wallMs) */
  httpMs: number;
  /** redacted evidence events (also written to evidencePath when set) */
  events: Record<string, unknown>[];
}
