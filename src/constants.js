// Every pinned constant in one file (RFC 0001 invariant 7: constants, not configuration).
// The fixture and the runner import the same values; invariant 8's determinism claim for
// transient-state assertions rests on the poll interval being far smaller than the job window.

// Runner
export const POLL_INTERVAL_MS = 100;        // 10 observations inside a long job's window
export const POLL_UNTIL_TIMEOUT_MS = 10000; // 10x the longest fixture job
export const DRAIN_TIMEOUT_MS = 15000;      // queue depth 2 x long job x safety margin
export const REQUEST_TIMEOUT_MS = 5000;     // socket-level timeout; hitting it is an `error`, not a `fail`
export const REDACT_HASH_PREFIX_LEN = 8;    // [REDACTED:<sha256-prefix>] length in evidence JSONL

// Fixture
export const FIXTURE_JOB_LONG_MS = 1000;    // jobs whose code calls sleep(); wide enough to observe IN_PROGRESS
export const FIXTURE_JOB_SHORT_MS = 0;      // everything else completes on the next tick
export const FIXTURE_QUEUE_CAPACITY = 2;    // the 2022 AUT's documented concurrency limit
