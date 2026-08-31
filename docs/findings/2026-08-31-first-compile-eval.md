# Findings: the first live compile eval (2026-08-31)

The first full-corpus `npm run eval:compile` — 24 sections, model `claude-opus-5`, contract
`92d43e337f5d`, 347s wall (~14.5s/section). Raw report: `.eval-runs/2026-08-31-92d43e337f5d/`.

Headline: **the compiler is in good shape, and the eval's own scoreboard was wrong.** Both
findings below were produced by reading the persisted report rather than the summary line —
which is the argument for persisting it.

## 1. "58.3% gate pass-rate" was a metric bug, not a result

The run reported 24 sections → 14 compiled, 10 skipped, and the pass-rate counted skips as
misses. But **zero candidates were refused, zero were unparseable, validation was clean, and
lineage was intact**: the gate had nothing to reject. Of the sections that were meant to
compile, 14/14 did — 100%.

Skipping was correct, and the stated reasons were the strongest evidence in the run. Ten
sections are prose about the *test framework* (objective, requirements, test-strategy,
technology-stack) or quality attributes with no route or status code. On `api-guarantees-2`
the compiler reasoned that "never any status code other than 200 or 4xx" is a universal
negative over a status *range*, that `expect.status` takes a single integer with no range
matcher, and that choosing a specific 4xx "would mean inventing a status code this section
does not state" — then named the sections that cover the claim concretely. That is the oracle
discipline holding under pressure: refusing to fabricate an assertion is the desired
behavior, and it is what §4.5 exists to protect.

**Fixed:** pass-rate is now `compiled / (compiled + refused + unparseable + transport-error)`,
with skips reported separately as a legitimate outcome.

## 2. The compiler now out-covers the 2022 humans

44 cases from 14 sections, against the committed corpus's 26 from 16. `robustness-2` alone
produced 15 — and they are not padding. They decompose "any valid script" by construct
(single-line, multi-line, loop, conditional, function **defined** vs **defined-and-invoked**,
class **defined** vs **defined-and-invoked**), then cover idempotency, both failure paths, and
the full PENDING → IN_PROGRESS → COMPLETED/FAILED lifecycle. Separating "accepts the script"
from "returns the right value" is a real distinction — case 005 passed where 006 failed.

This is the README's "divergences the hand-written suite silently encoded" phenomenon
recurring: the 2022 suite read "any valid script" and tested arithmetic; the compiler read the
same sentence and tested control flow and object construction.

**Not adopted.** `cases/` serves two masters — it is the repo's *test fixture*
(`determinism.test.js` hard-codes 26 cases and 26 passes; the bench baseline and the published
numbers cite it) and a demonstration of compiler output. Those have opposite stability needs,
and 19 of the 44 fail against this bed, so adopting them would leave the "fixture" red. The
committed corpus is versioned test infrastructure, changed deliberately; `.eval-runs/` is
where current compiler behavior is observed. For real users the same tension already has an
answer: recompile the section whose intent changed (`--section`, guided by stale flags) and
review that diff; a full recompile is a rare, reviewed event like a major-version bump.

## 3. The 19 failures were 0 regressions

| bucket | n | what it means |
|---|---|---|
| 401 vs 403 on every isolation/cross-user case, including all 5 minted `result-isolation` probes | 7 | **The tool working.** BUG-2022-01, caught fresh seven ways in one run. |
| `jp-*` cases scored against the wrong service | 5 | **Harness bug.** Those sections describe jsonplaceholder; the eval ran them against the groovy bed and collected 401s. The cases themselves are correct. |
| loop / conditional / invoked function / invoked class / queued result → `null` | 5 | **Bed scope.** The fixture does not execute control flow (DESIGN.md §8). Correct against the real service. |
| thrown exception reported "no signature of method"; `def x =` accepted with 200 | 2 | **Genuine bed defects — fixed.** Both were the fixture answering *wrongly*, not incompletely, and both were cheap to correct. |

**Fixed:** the eval excludes sections targeting another service from the run (reporting them
as "not run" rather than failed), and carries `eval/expected-failures.json` — a named, reasoned
baseline subtracted from the count so the run reports **regressions**.

The baseline matches on **diff signature, not case id**. Case ids are chosen by the model on
every compile (`CASE-submit-valid-loop-script-003`), so an id-keyed list would report the same
known issues as fresh regressions under new names on the very next run. Signatures — `status
expected 403 got 401`, `body.result got null` — survive recompilation. A failure counts as
expected only when *every* one of its diffs matches, so a case that breaks in a known way
**and** a new way stays visible; and a signature that stops matching anything is reported, so
the list shrinks when a cause is fixed rather than rotting.

Re-classified under the new scoreboard, this run reads: 100% gate pass over 14 attempted,
10 correctly skipped, 5 not run, 12 expected failures, **0 regressions**.

## Cost baseline

347s for 24 sections on Opus, one sequential call each. Worth knowing before the next run.
