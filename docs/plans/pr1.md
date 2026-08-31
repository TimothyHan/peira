# PR1 implementation plan — schema, runner, evidence log, fixture

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.3/§4.5/§7/§8 and the
[2022-corpus DSL audit](../findings/2026-08-27-dsl-audit.md). Planning is one PR at a time by
decision; PR2+ stay at the resolution of RFC §7 until PR1 lands.*

## Goal

**RFC §7:** case schema + deterministic runner + evidence log; hand-written cases only.
Zero-dep Node ≥ 18.

**Gate (RFC §8):** the five primitives, with the §4.3 amendments, re-express all 27 executable
2022 specs as cases, running green against the in-repo fixture with zero escape hatches and zero
sleeps. Two same-seed runs against a fresh fixture produce identical verdicts.

No LLM appears anywhere in PR1 — the compiler is PR2. PR1 proves the *target format* and the
*execution substrate* are sound before anything compiles into them.

## Out of scope (named so nobody re-litigates mid-PR)

- Compiler, intent layer, lineage-hash verification (PR2). Cases still carry `from` blocks —
  hand-written lineage pointing at the 2022 test plan sections — but nothing validates hashes yet.
- Steps / escape hatches / telemetry (PR3). The schema refuses unknown keys, so a step reference
  is a validation error in PR1 by construction.
- Invariant templates and generators (PR4).
- Triage (PR5). Verdicts are recorded; nothing classifies them.
- Fixture behavior plants / deliberate shifts (PR5 — decided 2026-08-29: the fixture ships plain;
  the plant mechanism is designed when triage needs it).
- OpenAPI anything.

## Repo layout after PR1

```
peira/
├── bin/peira                  # CLI entry (node shebang): validate | run
├── src/
│   ├── constants.js           # every pinned constant in one file (invariant 7)
│   ├── schema.js              # vendored JSON-Schema-subset validator
│   ├── validate.js            # schema gate + static checks (refusals + warnings)
│   ├── interpolate.js         # $refs and {{token}} resolution
│   ├── expect.js              # subset match + matcher vocabulary
│   ├── runner.js              # execution engine → verdicts
│   ├── evidence.js            # JSONL evidence log + redaction
│   └── http.js                # thin fetch wrapper (timeouts, basic-auth header)
├── schema/case.schema.json    # THE DSL definition (RFC §4.3: a primitive exists iff admitted here)
├── cases/2022-corpus/         # 27 hand-written cases, the ported ground truth
├── test/
│   ├── fixtures/server.js     # the validation bed (zero-dep HTTP server)
│   ├── fixtures/bed.json      # bed config: baseUrl, $users principals, reset hook
│   ├── refusals/              # invalid-case fixtures the validator must refuse, one file each
│   └── *.test.js              # node:test suites (inventory below)
├── docs/                      # DESIGN.md, findings/, plans/ (this file)
└── package.json               # name "peira", bin "peira", zero dependencies, engines.node >= 18
```

Tooling conventions: `node:test` + `node:assert` for Peira's own tests (zero-dep rules out every
test framework); no build step; no TypeScript (JSDoc types where they pay).

## The schema (the DSL, verbatim from RFC §4.3 + audit amendments)

Top level: `id` (`CASE-` prefix), `from` (`{intent, hash}`, both required — lineage is mandatory
from day one even when hand-written), optional `setup` (array of steps), required `test`, optional
`teardown` (`{"drain": true}` only). `additionalProperties: false` at every level — the schema
refuses what it does not name, because refusal is the gate (RFC §1).

Per step: `request` (`method`, `route`, optional `query`/`body`/`auth`), optional `capture`
(name → response path like `body.id`), optional `pollUntil` (`{request, until, timeoutMs?}` where
`until` is an expect-shaped predicate), optional `expect` (`status`, optional `body`, optional
`bodySchema`).

Amendments, normative (audit A/B/C):
- **Matchers:** expected bodies admit `{"$any": "string" | "number" | "boolean"}` and literal
  `null`. Closed list. Match semantics are Jest `toMatchObject` exactly: subset at every object
  level, index-wise subset for arrays.
- **Auth:** `"$users.<alias>"` | literal `{username, password}` | absent (anonymous). Resolved to
  HTTP basic auth in PR1 (the corpus's mechanism); other schemes wait for demand.
- **Interpolation:** a whole value equal to `"$name"` resolves to the captured/derived value
  (type-preserving); `{{name}}` resolves inside strings at any depth, in requests and expected
  bodies both; `{{{{` escapes a literal `{{`. Namespaces: `$<capture>` (case-local, from `capture`),
  `$unique.<key>` (seed-derived per run), `$users.<alias>` (bed config).

Static checks in `validate.js` beyond the schema — **refusals:** a `$`/`{{}}` reference that no
prior capture, `$unique`, or bed principal can satisfy (resolution is statically decidable because
capture order is lexical); any wall-clock sleep vocabulary (there is none in the schema — the check
exists so the error message says "use pollUntil", not "unknown property"). **Warnings:** an `expect`
with a `status` but empty/absent `body` (legal, but flagged so weak oracles are visible).

## Execution semantics (runner.js)

- A run = bed config + case files + seed (`--seed <n>`, default: random, always printed and
  recorded — reproduction is `peira run --seed <n>`).
- Cases execute **sequentially** in sorted-filename order. Parallel scheduling is a later PR;
  determinism is the PR1 product and the corpus's own "parallel" section tests the AUT's
  concurrency via its queue, not the runner's.
- Per case: setup steps in order → test → teardown. `capture` writes into case-local
  `runtimeData`; nothing leaks between cases.
- `pollUntil`: re-issue the request every `POLL_INTERVAL_MS` until the `until` predicate matches
  or `timeoutMs` (default `POLL_UNTIL_TIMEOUT_MS`) elapses. Timeout → the step's verdict is `fail`
  with the last response as evidence (the service answered; the assertion never held).
- `teardown {drain: true}`: poll every job id the case captured until each reaches a terminal
  state (COMPLETED/FAILED), capped at `DRAIN_TIMEOUT_MS`. Drain overrun → **warning + `error`**,
  not `fail` — the case's own assertions already concluded; a poisoned queue is infrastructure.
- **Verdicts (RFC §4.7):** `pass` | `fail` (an assertion did not hold) | `error` (infrastructure
  failed first: connection refused, DNS, socket timeout before any assertion evaluated). Never
  conflated; a run's exit code is nonzero iff any non-`pass` exists, and the summary reports the
  three counts separately.
- `$unique.<key>` values derive deterministically from (seed, case id, key) — invariant 8. Same
  seed → byte-identical payloads.

## Evidence log (evidence.js)

Append-only JSONL per run: `run-start` (seed, bed hash, case count, tool version), per case
`case-start` / one event per HTTP exchange (request, response status + body, elapsed) /
`case-verdict` (verdict, failed assertion diff if any), `run-end` (counts, duration).
**Redaction (invariant 9) is applied at write time, in evidence.js, not by callers:**
`Authorization`, `Cookie`, `Set-Cookie` values are stored as `[REDACTED:<sha256-prefix-8>]` —
equality across events survives, plaintext never lands. No other module writes to the log file.

## Fixture service (test/fixtures/server.js)

Implements the observable semantics the corpus tests (audit + RFC §8): HTTP basic auth against
bed-config users (`user_1`, `user_2`); `POST /groovy/submit` (validates payload, enqueues,
returns id); `GET /groovy/status?id=` (submitter-only visibility); async job lifecycle
PENDING → IN_PROGRESS → COMPLETED/FAILED; a capacity-2 worker queue. Route shapes mirror the
2022 AUT so ported cases read like their ancestors; the fixture stays honest — it never inspects
which case is calling.

**Pinned timing constants (normative — the constants invariant 8 points at; all in
`src/constants.js`, fixture and runner import the same file):**

| Constant | Value | Why this value |
|---|---|---|
| `FIXTURE_JOB_LONG_MS` | 1000 | long-running job duration; wide enough that a 100 ms poll observes IN_PROGRESS reliably |
| `FIXTURE_JOB_SHORT_MS` | 0 | completes on next tick; tests terminal-state paths without waiting |
| `POLL_INTERVAL_MS` | 100 | 10 observations inside a long job's window |
| `POLL_UNTIL_TIMEOUT_MS` | 10000 | 10× the longest job; a timeout is a real failure, not scheduling noise |
| `DRAIN_TIMEOUT_MS` | 15000 | queue depth 2 × long job × safety margin |

Transient-state cases (PENDING, IN_PROGRESS) are exactly the audit's watchlist item 1: against
this fixture the pinned ratio (poll ≪ job duration) makes them deterministic; the plan makes no
claim beyond the fixture.

## Corpus port (cases/2022-corpus/)

All 27 executable specs, one JSON case each, section structure preserved (auth / submit / status /
robustness / parallel). The audit is the requirements list; porting notes that bind:

- Every 2022 sleep (the global 100 ms pre-test sleep, `teardown.sleep`) becomes `pollUntil` or
  `teardown.drain` — zero sleeps is a gate condition, enforced by the validator.
- `1-5` ports **as observed** (expects 401): PR1's job is re-expressing the ancestor faithfully.
  The 403-vs-401 divergence is PR2's pre-registered adjudication specimen, not PR1's to fix.
- The duplicated spec (`3-6`/`4-6`) ports once, with a lineage note.
- `4-5`/`5-3` (transient states) use `pollUntil` with the transient state as target — the
  watchlist pattern, expressible in v1.
- `from.intent` points at the 2022 test-plan section id (derive-mode slug), `from.hash` is the
  real sha256 prefix of that section's text — hand-computed now, verified mechanically in PR2.

## Peira's own tests (node:test — the gate for the gate)

| Suite | Asserts |
|---|---|
| `schema.test.js` | vendored validator: type/required/properties/additionalProperties/enum/items/pattern each accept + refuse correctly |
| `validate.test.js` | every fixture in `test/refusals/` is refused with an error naming file + keyword path; the 27 corpus cases pass clean; empty-expect warns but passes; unresolved `$alias` refused |
| `interpolate.test.js` | whole-value `$ref` preserves type; `{{token}}` at depth and in-string; `{{{{` escape; unknown token throws |
| `expect.test.js` | toMatchObject parity (subset objects, index-wise arrays), `$any` matchers, literal `null`, mismatch produces a named diff |
| `runner.test.js` | against live fixture: green run; capture chaining; pollUntil success + timeout→fail; drain drains (case submitting 3 jobs on a capacity-2 queue leaves a clean queue) |
| `verdict.test.js` | fixture killed mid-run → `error` verdicts, never `fail`; exit-code semantics |
| `determinism.test.js` | two runs, same seed, fresh fixture → byte-identical verdict sequences; `$unique` values reproduce by seed |
| `evidence.test.js` | JSONL well-formed; `Authorization` values are `[REDACTED:` prefixed everywhere, including inside pollUntil retries; sha-prefix equality survives |
| `fixture.test.js` | the fixture honors its own semantics (auth, isolation, queue capacity, lifecycle) — so a red corpus case indicts the case, not the bed |

## Work order

Three lanes; A and B are independent, C is trivial and first.

- **Lane C (scaffolding):** `package.json`, `bin/peira` argument parsing, `src/constants.js`,
  CI workflow (`node --test` on Node 18/20/22).
- **Lane A (the tool):** `schema.js` → `case.schema.json` + `validate.js` + refusal fixtures →
  `interpolate.js` + `expect.js` (pure, test-first — they encode the semantics everything else
  trusts) → `evidence.js` → `runner.js`.
- **Lane B (the bed):** `fixture/server.js` + `bed.json` + `fixture.test.js`.
- **Merge point:** port the corpus (needs A's validator + B's fixture), then `runner.test.js`,
  `determinism.test.js`, `verdict.test.js` against the real bed.

## Acceptance checklist (the PR is done when)

- [x] `peira validate cases/` exits 0 on the corpus — the only output is the two expected
      weak-oracle warnings on `1-3`/`1-4` (the 2022 specs that genuinely asserted nothing about
      the body); every `test/refusals/` fixture is refused with a named error
- [x] `peira run` against the fixture → all 26 cases (covering 27 specs — `3-6`/`4-6` are
      verbatim duplicates, merged with a lineage note) pass, zero escape hatches, zero sleeps
- [x] Two same-seed runs, fresh fixture → identical verdicts; `--seed` reproduces payloads
- [x] Killing the fixture mid-run yields `error`, never `fail`
- [x] Evidence JSONL: no plaintext credential anywhere in a full-corpus run's log
- [x] `node --test` green locally (52 tests); Node 18/20/22 matrix wired in CI (verifies on first push)
- [x] No dependencies in `package.json`; no constant outside `src/constants.js`

**Implementation notes recorded for PR2+ (deviations worth knowing, all within RFC scope):**
- `pollUntil` is a step modifier that re-issues the step's own request (`{until, timeoutMs?}`),
  not a step with its own embedded request — simpler, and everything the corpus needed.
- The drain probe (route, id param, status path, terminal states) lives in the **bed config**,
  because how to ask "is this job settled?" is bed semantics, exactly like principals; each
  captured id is drained under the auth that captured it, preserving result isolation.
- The vendored schema subset also carries `anyOf` and internal `$ref` — required to express the
  three auth forms and to share `$defs/step`.
