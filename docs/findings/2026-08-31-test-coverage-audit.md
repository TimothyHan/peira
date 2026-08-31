# Findings: test-coverage audit (2026-08-31)

**Method:** `npx c8@10 --src=dist node --test test/*.test.js` over the 251-test suite as it
stood at audit time (254 after the gaps below were closed). Coverage is measured against
`dist` — the artifact that ships — and c8 propagates to spawned CLI subprocesses, so
CLI-level tests count.

## Numbers

| metric | value |
|---|---|
| statements | 91.8% (3427/3733) |
| branches | 83.7% (1169/1397) |
| functions | 94.0% (173/184) |

Lowest-covered modules, before the fixes below:

| module | stmts | note |
|---|---|---|
| `cli/run.js` | 49.3% | mostly a measurement artifact — see below |
| `cli/watch.js` | 61.7% | same artifact |
| `cli/validate.js` | 73.3% | **a real gap** — closed |
| `render-html.js` | 87.2% | report branches for artifact shapes the corpus never produces |

## Finding 1 — the watch machinery's coverage is unmeasurable, not absent

`cli/run.js` lines 79–171 (`reportStale`, `watchLoop`) and `cli/watch.js`'s fs plumbing read
as uncovered, but `test/watch-loop.test.js` demonstrably exercises them end to end: it
spawns `peira run --watch`, touches a case file, and asserts the scoped re-run appears in
the output. The reason coverage is not recorded is mechanical — the test ends the watch
process with a **signal**, and V8 only flushes coverage on clean exit. Treat these numbers
as unknown, not as zero; the behavior is guarded by assertion, which is what matters.

## Finding 2 — CLI stale reporting was genuinely untested (closed)

`checkStale` had unit tests, but the path that turns its output into console warnings, an
`ERROR` for a vanished section, and exit 1 had none — despite "stale flags name the
affected cases" being a documented promise. Closed by `test/validate-cli.test.js`: clean
case exits 0; a stale case names **both** hashes and stays a *warning* (it still runs); a
case whose intent section no longer exists is an error that exits 1.

## Finding 3 — compile quality was measured once, never guarded (closed)

The suite exercises `compile` only through canned transports (`PEIRA_CLAUDE_BIN`), which
proves the plumbing and the gate but not the *quality* of what the model returns. A prompt
edit (headers + `$contains` landed this week) or a model change could degrade the gate
pass-rate with every test still green — the schema gate makes such regressions *safe*
(refusals, never corruption) but not *visible*.

Closed by `npm run eval:compile` (`eval/compile-eval.js`) — opt-in, since it spends a real
session: it compiles the repo's own intent, then reports gate pass-rate by outcome, lineage
integrity (mechanically stamped, so a miss is a bug), validation cleanliness, and the
verdicts of actually **running** the compiled cases against the fixture. Ritual, not CI:
run it before a release and after any prompt or model change, and record the numbers here.

## Finding 4 — every test had only ever run on macOS (closed)

No Linux or Windows verification existed for a tool whose CI documentation targets Linux.
`.github/workflows/test.yml` now runs the suite on `ubuntu-latest` and `windows-latest`.
Two Windows-specific defects were fixed pre-emptively while writing it:

- `bed.service` used `process.kill(-pid)`, which has no meaning on win32 — it now branches
  to `taskkill /T /F` to fell the process tree, and only requests a detached process group
  on POSIX.
- Three service tests assumed the POSIX shell builtins `sleep`, `true`, and `false`; they
  now spawn `node -e …` equivalents that exist on every platform.

## Standing practice

Re-run the coverage audit when a subsystem lands, and read it for *never-executed branches*
rather than a percentage — the percentage is not a target and will never be 100 while
signal-killed subprocesses exist.
