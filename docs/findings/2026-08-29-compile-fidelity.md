# Compile fidelity: the 2022 test plan through `peira compile` — PR2 gate results

*2026-08-29. The PR2 gate experiment ([plan](../plans/pr2.md)): the ancestor's test plan,
ingested byte-verbatim via derive mode, compiled by `claude-opus-5` through the author's own
Claude session (`claude -p`), gated, and run against the PR1 fixture. Compare against the
hand-written PR1 corpus. Artifacts: `experiments/2022-compile/` (cases, manifest, run evidence);
reproduce the run with `--seed 42`.*

## Headline numbers

| Metric | Value |
|---|---|
| Intent sections ingested (zero edits) | 16 |
| Compiled | 6 (exactly the six AC sections) |
| Skipped with recorded reason | 10 (all prose/context/strategy sections — zero hallucinated coverage) |
| Unparseable / transport errors | 0 |
| Candidate cases emitted | 37 |
| Refused by the schema gate | **0** — 37/37 schema-valid on first attempt |
| Verdicts vs the fixture | **33 pass, 4 fail, 0 error** |
| Behaviors covered by the hand-written corpus, also covered here | all of them |

The four failures are the product working: each one is a place where **the intent says one
thing and the implementation does another** — invisible to the 2022 suite, which encoded
observed behavior, and surfaced mechanically the moment cases were compiled from intent instead.

## The divergence table (pending author adjudication)

| # | Intent (AC) | Compiled expectation | Observed | 2022 suite's stance | Notes |
|---|---|---|---|---|---|
| 1 | 1.4: cross-user fetch → **403 Forbidden** | 403 | **401** | spec `1-5` asserts 401 — bent to observed | The pre-registered specimen (RFC §8). Fired twice: the Requirements-side isolation invariant compiled the same 403 (`CASE-result-hidden-from-non-submitter-001`). |
| 2 | 3.6: invalid id → **404 Not found** | 404 | **400** | spec `3-6` asserts 400 — bent to observed | Second wild divergence, found while planning PR2, confirmed by the run. |
| 3 | 3.4: payload with extra fields → **400** | 400 | **200** (extras ignored) | spec `3-4` never tested it — its test actually sends *no* id (mislabeled) | Novel probe: compilation-from-intent explored territory the hand-written suite mislabeled and skipped. Against the real 2022 AUT this behavior was never observed; the fixture implements the lenient reading. |

Per RFC §4.7's taxonomy these are **bug** candidates (behavior contradicts intent) unless the
author amends the intent — precisely the adjudication PR5's triage will mechanize. The 2022
suite could never raise them: it was written *from* the observed behavior.

## What the model did well

- **Skip discipline:** every prose section skipped with a specific, correct reason; no case was
  invented for "Objective", "Quality attributes", or the framework-design sections.
- **Schema compliance:** 0/37 gate refusals — the contract prompt plus a deterministic gate
  produced clean shapes without API-side structured outputs (decision D2 vindicated for this
  corpus; the gate's value shows in the *guarantee*, not the catch count, at n=37).
- **Idiomatic DSL:** unprompted use of `{{unique.nonce}}` payload discriminators, `pollUntil`
  for every eventually-consistent assertion, `teardown.drain` on queue-occupying cases,
  literal-credential auth for negative tests.
- **Coverage:** all 26 hand-written behaviors re-derived from intent alone, plus novel probes
  (the extra-field case, string-result assertions, a division-by-zero FAILED path).

## What the model did less well (compile-quality observations)

- **Weaker oracles than the human's:** 16 of 37 cases assert status-only where the hand-written
  corpus asserts the full error envelope (`error`/`message`/`path`/`timestamp`). All are flagged
  by the validator's weak-oracle warning — the lint exists for exactly this. A contract-prompt
  nudge ("assert the response body's observable shape, not just status") is the cheap fix.
- **Three needless `teardown.drain` declarations** on cases that capture nothing (warned, harmless).
- **Silent sub-AC drops:** ACs 4.9–4.11 (manual/load/stress, correctly not automated) left no
  manifest trace because they share the `robustness-2` section with 15 compiled ACs — manifest
  granularity is per-section. Per-AC accounting within a section is future coverage bookkeeping
  (the lineage-manifest work RFC §4.2 assigns to stub-replacement).

## Bed corrections made during the experiment

Five compiled cases initially failed on **fixture artifacts, not divergences**: the bed's
mini-groovy was narrower than the real AUT's language (only what the 2022 corpus exercised).
Corrected for parity, each with a regression test: `//` line comments; string-literal `return`
results; typed method declarations (`String greet()`); numeric `def` bindings in arithmetic;
division-by-zero → FAILED. The PR1 corpus is unaffected (full suite 75/75 green). Lesson
recorded: **compiled corpora probe beyond the observed corpus by construction** — bed fidelity
requirements grow with compilation, and misclassifying bed artifacts as bugs is exactly the
trap the pass/fail/error split (and later, triage) must guard.

## Verdict equivalence (compile-fidelity metric)

For every behavior both corpora cover, hand-written and compiled cases agree on the verdict —
**except** where the hand-written case encodes observed behavior and the compiled case encodes
intent (divergences 1 and 2 above). That asymmetry is not noise; it is the measurement working:
agreement everywhere reality matches intent, principled disagreement exactly where it does not.
