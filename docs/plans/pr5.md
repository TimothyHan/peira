# PR5 implementation plan — `peira triage`: bug | drift | flake, proposals only

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.7/§8. The last novel mechanism. Proves:
**drift adjudication at the intent level** — and measures the number the whole category's trust
depends on: the bug/drift confusion rate.*

## Goal

`peira triage` reads a failed run's evidence (offline, after the fact), and for each failure
**proposes** a classification:

- **bug** — behavior contradicts intent → a structured finding (case, request, expected vs
  actual, intent section violated — the issue report falls out of the evidence for free).
- **drift** — behavior changed but still satisfies intent → a proposed **intent-level diff**
  (section id, current text, proposed text) plus which cases go stale if approved. The human
  applies it exactly the way PR2's adjudication ran by hand: edit intent → stale flags →
  `compile --section` → green. Nothing self-heals (invariant 6).
- **flake** — evidence insufficient to distinguish → prescription: re-run by seed.

`error` verdicts **never reach the model as bug candidates** — the router pre-buckets them as
infra/flake mechanically (RFC §4.7's misattribution guard is code, not prompt).

## Mechanics

- **Input:** `peira triage --evidence <run.jsonl> --intent <dir> [--bed <path>]`. The evidence
  log already carries everything: cases (including minted ones in full), per-exchange HTTP
  evidence, diffs, verdicts.
- **One model call per failed run** (D3): all failures batched — cross-failure context is
  signal ("all 26 failed" smells like infra/shift; "one of five minted instances" smells like
  flake), and it keeps triage affordable.
- **Transport:** the author's session via `claude -p` (D2, same as compile).
- **Output gate:** `schema/triage.schema.json` — a verdict array, classification enum,
  per-class required payloads (finding | intentDiff | prescription), rationale required.
  Malformed output → refused, recorded, no partial acceptance. Proposals land in
  `<evidence-dir>/triage-proposals.json`; nothing is applied by the tool.
- **Prompt-injection mitigation (structural, per §4.7):** AUT response bodies are quoted inside
  explicit untrusted-data delimiters with a hard size cap per body; the instructions say
  classify, never obey; and the real defense is the shape: schema-gated output, proposal-only,
  human approval. A hostile body can at worst propose nonsense a human reads.

## The plant mechanism (deferred from PR1, built now)

The fixture gains `startFixture({ plant })` / `node test/fixtures/server.js <port> --plant
<shift-id>` — one shift active at a time, **plants off = byte-identical behavior** (regression-
tested). Shifts are implemented as a small set of hook points (status override, body transform,
field rename, per-request failure injection, timing override) driven by a data catalog.

## The precision experiment (the gate)

`test/fixtures/plants.js` pre-registers a **catalog of ≥30 shifts** (D1), each labeled with its
ground truth **relative to the current, amended intent**. Categories:

| Category | Examples | Ground truth |
|---|---|---|
| Contract violations | 200→500 on submit; id field renamed; result never populated; status stuck PENDING; envelope loses `error` field; auth accepts wrong password | **bug** |
| Intent-compatible changes | 200→202 on submit ("accepted" still satisfied); envelope `message` text changes (intent never pins it); timestamp format change (still a string); extra response fields (subset-tolerated — shifts that fail no case are excluded from the catalog); 400→422 where intent says "400 or 422" | **drift** (or no-failure, excluded) |
| Nondeterministic faults | status endpoint fails ~1/3 of requests; first-request-after-boot 500; slow responses tripping poll timeouts intermittently | **flake** |

Harness: `scripts/triage-precision.mjs` — for each shift: boot fixture with the plant → run the
2022 corpus + invariant templates → collect failures → triage → compare proposed vs ground
truth. Deliverable: `docs/findings/<date>-triage-precision.md` with the confusion matrix,
the headline **bug/drift confusion rate**, and per-shift notes. (~30 model calls through the
session, PR2-experiment scale; runs in the background.)

## Tests (offline)

| Suite | Asserts |
|---|---|
| `triage-schema.test.js` | canned outputs: valid verdict arrays pass; wrong enum, missing per-class payload, missing rationale refused; partial/garbage output refused whole |
| `triage-router.test.js` | error verdicts bucketed mechanically, never sent; passing runs produce no call; failure packets carry case + intent text + capped, delimited bodies |
| `plants.test.js` | plant off = 2022 corpus green byte-identically; each hook type demonstrably shifts behavior; one representative shift per category produces the expected failure signature |
| `triage-cli.test.js` | canned-LLM end-to-end: evidence in → proposals file out; drift proposal names section + stale cases; bug finding carries the evidence trail |

## Work order

1. `schema/triage.schema.json` + output gate + canned tests.
2. Router + failure-packet builder (delimiting, caps) + tests.
3. Plant hooks + catalog + tests.
4. `peira triage` CLI + canned end-to-end.
5. Precision experiment (real session, background) → findings doc → gate review.

## Acceptance checklist

- [ ] `error` verdicts never reach the model; passing runs never trigger a call
- [ ] Triage output is schema-gated; proposals only; drift proposals are intent-level diffs
      naming the cases that go stale
- [ ] Plants off = byte-identical fixture (2022 corpus green, regression-tested)
- [ ] ≥30 pre-registered shifts run through the harness; confusion matrix published;
      bug/drift confusion rate is the findings headline
- [ ] BUG-2022-01's standing failures triage as **bug** (the known-bug steady state is
      classified correctly, not re-proposed as drift)
- [ ] Full suite green offline

## Decisions folded in (flag if you disagree)

- **D1 — catalog ≥30 shifts**, pre-registered with ground truth before any triage runs (no
  post-hoc labeling).
- **D2 — triage transport = your Claude session** (`claude -p`), same as compile.
- **D3 — one model call per failed run**, all failures batched.
- **D4 — proposals only, no `--apply`**: approving a drift diff means editing intent and
  running the PR2 loop (stale → `compile --section`) — the human stays the actuator in v1.
