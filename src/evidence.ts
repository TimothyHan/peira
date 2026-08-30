// Append-only JSONL evidence log. Redaction (RFC 0001 invariant 9) is applied here, at write
// time, and nowhere else: no other module writes to the log file, so a credential cannot land
// in plaintext by a caller forgetting to redact.

import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { REDACT_HASH_PREFIX_LEN } from './constants.js';

const REDACTED_KEY = /^(authorization|cookie|set-cookie)$/i;

export function redactValue(value: unknown): string {
  const digest = createHash('sha256').update(String(value)).digest('hex');
  return `[REDACTED:${digest.slice(0, REDACT_HASH_PREFIX_LEN)}]`;
}

/** Deep-copy `value` with every credential-bearing header value replaced by its hash tag. */
export function deepRedact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(deepRedact) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, REDACTED_KEY.test(k) ? redactValue(v) : deepRedact(v)]),
    ) as T;
  }
  return value;
}

export class EvidenceLog {
  filePath: string | null;
  events: Record<string, unknown>[] = [];

  /** @param filePath null disables persistence (events still returned for tests) */
  constructor(filePath: string | null) {
    this.filePath = filePath;
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, ''); // one file = one run; a reused path must never mix runs
    }
  }

  append(event: Record<string, unknown>): Record<string, unknown> {
    const redacted = deepRedact(event);
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
