// Append-only JSONL evidence log. Redaction (RFC 0001 invariant 9) is applied here, at write
// time, and nowhere else: no other module writes to the log file, so a credential cannot land
// in plaintext by a caller forgetting to redact.

import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { REDACT_HASH_PREFIX_LEN, SECRET_MIN_LEN } from './constants.js';

// Key-based: credential-bearing headers, plus the two keys a login exchange introduces (RFC 0002
// §3.5) — a login request body carries `password`, a login response body carries `token`.
const REDACTED_KEY = /^(authorization|cookie|set-cookie|password|token)$/i;

/**
 * Value-based redaction (invariant 9, revised). Every token the runner obtains or is handed is
 * registered here; any string CONTAINING one is scrubbed at write time. Key-based rules cannot
 * cover a token sent under a custom header name or echoed inside an unrelated response body —
 * only knowing the value can. Shared by every EvidenceLog of one run, per-case buffers included.
 */
export class SecretRegistry {
  private readonly values = new Set<string>();

  /** Returns false (and registers nothing) for values too short to scrub safely. */
  register(value: unknown): boolean {
    if (typeof value !== 'string' || value.length < SECRET_MIN_LEN) return false;
    this.values.add(value);
    return true;
  }

  /** Longest first, so an overlapping shorter secret never splits a longer one's tag. */
  ordered(): string[] {
    return [...this.values].sort((a, b) => b.length - a.length);
  }

  get size(): number {
    return this.values.size;
  }
}

function scrub(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(redactValue(secret));
  }
  return out;
}

export function redactValue(value: unknown): string {
  const digest = createHash('sha256').update(String(value)).digest('hex');
  return `[REDACTED:${digest.slice(0, REDACT_HASH_PREFIX_LEN)}]`;
}

/**
 * Deep-copy `value` with every credential-bearing key's value replaced by its hash tag, and
 * every registered secret scrubbed out of every string.
 */
export function deepRedact<T>(value: T, secrets: SecretRegistry | string[] = []): T {
  const ordered = Array.isArray(secrets) ? secrets : secrets.ordered();
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, REDACTED_KEY.test(k) ? redactValue(v) : walk(v)]),
      );
    }
    if (typeof node === 'string' && ordered.length > 0) return scrub(node, ordered);
    return node;
  };
  return walk(value) as T;
}

export class EvidenceLog {
  filePath: string | null;
  events: Record<string, unknown>[] = [];
  /** shared across a run's logs so a token learned by one case is scrubbed from every other */
  readonly secrets: SecretRegistry;

  /** @param filePath null disables persistence (events still returned for tests) */
  constructor(filePath: string | null, secrets: SecretRegistry = new SecretRegistry()) {
    this.filePath = filePath;
    this.secrets = secrets;
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, ''); // one file = one run; a reused path must never mix runs
    }
  }

  append(event: Record<string, unknown>): Record<string, unknown> {
    const redacted = deepRedact(event, this.secrets);
    this.events.push(redacted);
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(redacted) + '\n');
    return redacted;
  }

  /**
   * Fold another EvidenceLog's events into this one. The source log already redacted at its
   * own write time (redaction is not idempotent — re-hashing a redaction tag would corrupt
   * it), so events are adopted verbatim. Only EvidenceLog instances may be adopted; the
   * "no other module writes to the log" invariant holds.
   */
  adopt(source: EvidenceLog): void {
    for (const event of source.events) {
      this.events.push(event);
      if (this.filePath) appendFileSync(this.filePath, JSON.stringify(event) + '\n');
    }
  }
}
