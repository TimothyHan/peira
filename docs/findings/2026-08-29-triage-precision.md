# Triage precision: 33 pre-registered shifts through `peira triage` — PR5 gate results

*2026-08-29. The PR5 gate ([plan](../plans/pr5.md)): every shift in the pre-registered catalog
(`test/fixtures/plants.js`, labeled bug/drift/flake against the amended intent BEFORE any triage
ran) booted into the fixture, run against the 2022 corpus, and triaged through the author's
session. Artifacts: `experiments/triage-precision/results.json`. Two rounds were run; both are
reported, because round 1's failure is itself a load-bearing finding.*

## Headline numbers (round 2, the graded run)

| Metric | Value |
|---|---|
| Shifts | 34 (33 catalog + the standing-bug check) |
| Graded (produced failures) | 33 |
| Majority classification correct | **25/33 (76%)** |
| **Bug/drift confusion rate** (the category-trust headline) | **4/33 (12.1%)** |
| Drift detection | 8/9 correct |
| Standing `BUG-2022-01` (unplanted, minted probes) | **bug ✓** — a known bug is not re-proposed as drift |
| Gate refusals / invented case ids / uncovered failures | 0 across all 34 calls |
| Corpus blind spot found | `queue-capacity-one` fails no case — `pollUntil` masks capacity loss (a real suite-sensitivity finding) |

## Round 1: the harness starved the judge — and the judge said so

Round 1 scored 7/32, in a pattern too systematic to be judgment: almost everything → flake.
The model's own rationales named the cause: *"intent section 2022-test-plan/1.1 is NOT FOUND."*
The hand-written corpus's lineage used 2022-plan numbering that resolves to no derive-mode
section, so triage received **no intent text** — and, instructed to judge against intent, it
refused to guess: insufficient evidence → flake, stated plainly. Bug/drift confusion in round 1:
**0**. The discipline held; the wiring was wrong.

Lesson promoted to a requirement: **triage quality is bounded by lineage resolution.** Fixed by
regenerating the corpus lineage to live section ids + hashes (which also brought the hand
corpus under stale detection — a dividend), and re-running.

## Round 2 misses, examined (8)

The confusion matrix is honest; the misses are more interesting than the score:

1. **The model out-judged a label (1×).** `unauthorized-label-changed` was registered *drift*
   (envelope wording). The model looked past the cosmetic change, saw a cross-user probe
   answered 401-family against AC 1.4's 403, and said **bug** — it re-detected `BUG-2022-01`
   underneath the planted drift. The pre-registered label was wording-myopic; the model read
   the behavior. Scored as a miss (pre-registration is pre-registration), flagged as a
   label-quality issue, not a model one.
2. **Section-granular lineage withheld the decisive text (3×).** `submit-id-renamed`,
   `status-id-renamed`, `status-result-dropped`: the field names are pinned by ACs 2.3/3.3,
   but many failing cases' lineage points at *other* sections (security, robustness) that
   never name the field — triage sees only the linked section and concludes "unpinned → drift."
   Design implication for a future PR: give triage the **whole intent document** as context
   (as compile already gets), with the linked section highlighted.
3. **Deterministic-vs-race ambiguity (2×).** `result-always-null` ("COMPLETED with result null
   on a 2ms probe — read-after-write race signature") and `queue-capacity-three` (transient-
   state timing reading). Both rationales are genuinely plausible from one run's evidence; the
   audit's transient-state watchlist biting exactly where predicted.
4. **Flake inference needs cross-run evidence (2×).** `fail-every-3rd-status` and `fail-first-2`
   went to bug (one also colored by the standing 403 bug in its sampled failures);
   `submit-fail-random` — where the passing/failing ratio was starkest — was correctly flake.
   1/3 on flakes says single-run evidence under-determines intermittency; the tool's own
   prescription ("re-run by seed, compare") is the missing evidence channel. Roadmap: a
   re-run-and-diff mode as first-class triage input.

## What held without exception

- Structural guards: zero prompt-injection incidents (hostile-body test is in the offline
  suite), zero invented case ids, zero schema-refused outputs across 34 live calls, `error`
  verdicts never reached the model, passing runs never triggered a call.
- Proposals stayed proposals: intent diffs quote the exact current line; bug findings carry
  the evidence trail; nothing was applied by the tool.

## Verdict on the gate

The pre-registered headline — bug/drift confusion 12.1%, zero in the direction that silently
buries bugs as drift in round 1 and 1/33 (`unauthorized-label-changed`, where the "confusion"
was the model finding a real bug) in round 2 — plus the standing-bug check passing, meets the
gate. The two identified levers (whole-document context, re-run evidence for flakes) are
recorded demand, to be built the same way DSL primitives are: from evidence, when it recurs.
