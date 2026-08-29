# PR2 implementation plan — intent layer, compiler, lineage, fidelity measurement

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.2/§4.4/§7/§8 and the live 2022 test plan
(`apiTestTask/doc/test-plan.md`). One PR at a time; PR3+ stay at RFC §7 resolution.*

## Goal

**RFC §7:** intent layer (tagged + derived markdown) + `peira compile` with schema gate,
lineage hashes, manifests.

**Gate (RFC §8):** compile the 2022 test plan's acceptance criteria — ingested via derive mode,
**zero edits** — and measure fidelity against the hand-written PR1 corpus: agreement rate,
hallucinations refused by the gate, honest disagreements adjudicated by the author.

This is the first PR that touches an LLM. The boundary stays exactly where the RFC drew it:
the model runs at **authoring time only**, its output enters the repo only through the schema
gate, and CI never needs a network or an API key.

## What the corpus actually contains (read 2026-08-29 — richer than pre-registered)

The 2022 test plan diverges from the 2022 specs in more places than the one registered specimen.
All become fidelity data:

1. **AC 1.4 → 403** for cross-user access; spec `1-5` asserts the observed 401. The registered
   specimen (RFC §8). A faithful compiler emits 403; the run fails; that failure is the pitch.
2. **AC 3.6 → "404 Not found when the id is not valid"**; spec `3-6` asserts 400. A second
   intent/spec divergence found in the wild, previously unrecorded anywhere.
3. **Numbering swap:** plan 1.1 = submit, 1.2 = fetch; spec files `1-1`/`1-2` have it reversed.
   Fidelity comparison must match on *behavior*, not id arithmetic.
4. **Non-automatable ACs:** 4.9/4.10/4.11 carry inline notes ("insufficient time", "manually
   tested", "different tool"). The correct compile is **no case + a manifest reason** — dropping
   with evidence, not hallucinating coverage (RFC invariant 4).
5. **Covered-by stubs:** 2.3, 5.1, 5.2, 5.4 duplicate other ACs; the compiler may merge or
   emit duplicates — the manifest must say which.

## Out of scope

- Escape-hatch steps (PR3). A section needing procedural logic is **refused with reason
  `needs-step`** in the manifest — recorded demand is exactly the telemetry §4.6 wants.
- Invariant templates + generators (PR4). `kind=invariant` sections compile to fixed example
  cases, manifest-noted as `generators-deferred`.
- Triage (PR5): the fidelity run's failures are recorded as verdicts + findings prose, not
  machine-classified.
- OpenAPI cross-check (no spec exists for the 2022 AUT; mechanism waits for a bed that has one).

## Modules

```
src/intent.js     markdown → sections: {id, kind, title, text, hash}
src/compile.js    sections + case-format contract → {cases, manifest}; LLM injected
src/llm.js        the one model-facing surface: fetch → api.anthropic.com/v1/messages
src/stale.js      case.from.hash vs live intent hash → stale flags (wired into validate/CLI)
```

- **intent.js:** every heading (`##`+, any depth) opens a section running to the next heading of
  the same-or-higher level. Tagged sections read `<!-- peira: id=… kind=ac|invariant -->`;
  untagged sections **derive** `id` from the heading slug, `kind=ac` — an existing test plan
  plugs in with zero edits (RFC §4.2). `hash` = sha256 (12-hex prefix) of the section's
  normalized text (LF line endings, per-line trailing whitespace stripped) — normalization is
  part of the contract, documented in the module.
- **compile.js:** prompt = case-format contract (the schema, the day-one primitive definitions,
  worked examples) + the bed principals + one intent section per request. The model returns a
  JSON array of candidate cases. Then the deterministic part: every candidate passes through
  `validateCase` (same gate as hand-written cases — one gate, no second path); **the compiler
  overwrites `from` mechanically** — lineage is stamped by code, never trusted from the model;
  refused candidates land in the manifest with their validator errors verbatim. The LLM is an
  injected `async (prompt) => text` — tests use canned transcripts, no network.
- **llm.js:** *(amended per D3, 2026-08-29)* the default transport spawns the **Claude Code CLI
  in headless mode** (`claude -p`, prompt over stdin) — compilation runs on the author's own
  Claude session, no API key, no billing surface, still zero-dep (`node:child_process`). Model
  from `constants.js` via `--model`; the binary is overridable with `PEIRA_CLAUDE_BIN` (tests
  point it at a canned-output script — the spawn path is tested for real, offline). A raw-fetch
  API transport can slot into the same injection seam later if a key-based workflow appears.
- **stale.js:** `peira validate --intent <dir>` recomputes section hashes and flags any case
  whose `from.hash` no longer matches — **warning** (regenerable artifact out of date), plus a
  hard error when `from.intent` names a section that no longer exists.

## CLI

```
peira compile <intentDir> --out <casesDir> [--bed <path>]   # requires ANTHROPIC_API_KEY
peira validate <casesDir> [--bed <path>] [--intent <dir>]   # + stale detection
```

Compile model and max-tokens are constants (invariant 7), not flags. Every compile writes
`<out>/compile-manifest.json`: model, prompt hash, per-section outcome
(`compiled: [case ids] | refused: [errors] | skipped: reason`), token usage.

## The fidelity experiment (the gate, run once by the author)

1. `intent/2022-test-plan.md` — byte-verbatim copy of the ancestor's `doc/test-plan.md`
   (provenance note at top of PR description, not in the file: zero edits is the claim).
2. `peira compile intent/ --out experiments/2022-compile/` with the real model.
3. `peira validate` + `peira run` the compiled corpus against the PR1 fixture.
4. Compare against the hand-written corpus **by verdict equivalence per behavior** (not per id —
   the numbering swap makes id-matching wrong): for each behavior both corpora cover, do the
   compiled case and the hand-written case agree on the verdict?
5. Deliverable: `docs/findings/<date>-compile-fidelity.md` — agreement rate, gate refusals
   (hallucination count), the adjudication table (1.4/403 and 3.6/404 pre-registered; anything
   else found), and the manifest accounting for every section including the non-automatable ones.

**Compiled artifacts are committed under `experiments/2022-compile/` — validated in CI, but NOT
part of the green run gate**: the compiled corpus *should* contain failing cases (403, 404) —
that failing-honestly is the product working. CI green stays defined by the PR1 corpus.

## Peira's own tests (offline, no key, no network)

| Suite | Asserts |
|---|---|
| `intent.test.js` | tagged parse; derive slugs + default kind; section boundaries at mixed heading depths; hash stability + normalization; the verbatim 2022 plan parses into the expected section set |
| `compile.test.js` | canned-LLM: valid candidates pass the gate and get mechanical lineage (model-supplied `from` is overwritten); malformed candidates refused with validator errors in the manifest; non-JSON model output → whole section refused, never crashes; every input section appears in the manifest exactly once |
| `stale.test.js` | edited section text → stale warning names case and hashes; deleted section → hard error; untouched → silent |
| `llm.test.js` | request shape via injected fetch (endpoint, model constant, key header, error paths: 401, 429, refusal stop reason) |
| CLI smoke | `peira compile` with a canned-LLM env hook writes cases + manifest; `validate --intent` wires stale flags |

## Work order

1. `intent.js` + tests (pure, no dependencies on the rest).
2. `stale.js` + validate/CLI wiring + tests.
3. `compile.js` with injected LLM + tests (the prompt contract lives here).
4. `llm.js` + tests.
5. Fidelity experiment (real key, author-run) → findings doc → gate review.

## Acceptance checklist

- [ ] The verbatim 2022 test plan ingests via derive mode with zero edits
- [ ] `peira compile` (canned LLM) writes only gate-passing cases; every section is accounted
      for in the manifest; lineage is mechanical
- [ ] Stale detection: an edited intent section flags its cases by name
- [ ] Offline test suite green with no `ANTHROPIC_API_KEY` present
- [ ] Fidelity run executed: agreement rate measured, refusals counted, 1.4/403 and 3.6/404
      adjudicated in the findings doc
- [ ] CI green gate unchanged (PR1 corpus); compiled corpus validated but not verdict-gated

## Decisions (author-approved 2026-08-29)

- **D1 — compiler model: `claude-opus-5`**, pinned in `constants.js`. Authoring-time only, so
  latency/cost are near-irrelevant and compile quality is the product; Fable 5 is the
  escalation if fidelity disappoints.
- **D2 — API-side structured outputs: no.** Plain JSON-in-prose prompt, with our own schema
  gate doing the refusing — `output_config.format` would blur the measured "hallucinations
  refused by the gate" metric; the gate is the product being tested.
- **D3 — compile transport: the author's own Claude session**, not the Claude API. The default
  transport shells out to the Claude Code CLI headless mode (`claude -p`); no `ANTHROPIC_API_KEY`
  anywhere in v1. The llm.js section above reflects this.
