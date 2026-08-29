// Append-only JSONL evidence log. Redaction (RFC 0001 invariant 9) is applied here, at write
// time, and nowhere else: no other module writes to the log file, so a credential cannot land
// in plaintext by a caller forgetting to redact.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { REDACT_HASH_PREFIX_LEN } from './constants.js';

const REDACTED_KEY = /^(authorization|cookie|set-cookie)$/i;

export function redactValue(value) {
  const digest = createHash('sha256').update(String(value)).digest('hex');
  return `[REDACTED:${digest.slice(0, REDACT_HASH_PREFIX_LEN)}]`;
}

/** Deep-copy `value` with every credential-bearing header value replaced by its hash tag. */
export function deepRedact(value) {
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, REDACTED_KEY.test(k) ? redactValue(v) : deepRedact(v)]),
    );
  }
  return value;
}

export class EvidenceLog {
  /** @param {string|null} filePath null disables persistence (events still returned for tests) */
  constructor(filePath) {
    this.filePath = filePath;
    this.events = [];
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  append(event) {
    const redacted = deepRedact(event);
    this.events.push(redacted);
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(redacted) + '\n');
    return redacted;
  }
}
