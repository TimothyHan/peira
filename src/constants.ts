// Every pinned constant in one file (RFC 0001 invariant 7: constants, not configuration).
// The fixture and the runner import the same values; invariant 8's determinism claim for
// transient-state assertions rests on the poll interval being far smaller than the job window.

// Runner
export const POLL_INTERVAL_MS = 100;        // 10 observations inside a long job's window
export const POLL_UNTIL_TIMEOUT_MS = 10000; // 10x the longest fixture job
export const DRAIN_TIMEOUT_MS = 15000;      // queue depth 2 x long job x safety margin
export const REQUEST_TIMEOUT_MS = 5000;     // socket-level timeout; hitting it is an `error`, not a `fail`
export const REDACT_HASH_PREFIX_LEN = 8;    // [REDACTED:<sha256-prefix>] length in evidence JSONL
export const SECRET_MIN_LEN = 16;           // shorter values are not registered for scrubbing: a 1-char 'secret' would mangle unrelated data (RFC 0002 §8)
export const STEP_TIMEOUT_MS = 10000;       // per-invocation ceiling for the child-process step harness
export const SERVICE_READY_TIMEOUT_MS = 30000; // default wait for bed.service to answer (override: service.readyMs)
export const INVARIANT_CASES_PER_RUN = 5;   // instances minted per invariant template per run (PR4 D1; RFC §9 resolved)
export const INTENT_SECTION_MAX_LINES = 40; // intent-lint advisory: bigger sections make stale detection and triage coarse

// Compiler (authoring time only — RFC 0001 invariant 1)
export const COMPILE_MODEL = 'claude-opus-5'; // decision D1, 2026-08-29
export const COMPILE_TIMEOUT_MS = 300000;     // per-section ceiling for the CLI transport

// Fixture
export const FIXTURE_JOB_LONG_MS = 1000;    // jobs whose code calls sleep(); wide enough to observe IN_PROGRESS
export const FIXTURE_JOB_SHORT_MS = 0;      // everything else completes on the next tick
export const FIXTURE_QUEUE_CAPACITY = 2;    // the 2022 AUT's documented concurrency limit
