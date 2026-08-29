# PR4 implementation plan — invariant templates + seeded generators

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.2/§4.4/§7. One PR at a time; PR5/PR6 stay
at RFC §7 resolution. Proves: **semantic properties mint real cases** — a human vouches for one
invariant sentence instead of reviewing thousands of generated assertions.*

## Goal

`kind=invariant` intent sections compile to a **case template with typed holes**; at run time
the runner instantiates **N fresh concrete cases per template** from seeded generators.
Deterministic given the seed (invariant 8): same seed → byte-identical minted cases → identical
verdicts; a failing generated case is re-runnable by seed alone.

## Template format (`templates/TPL-<slug>.json`)

A case, plus a `holes` block; hole references use the normal reference grammar under a
reserved namespace:

```jsonc
{
  "id": "TPL-result-isolation-001",
  "from": { "intent": "result-isolation", "hash": "…" },      // mechanical, like cases
  "holes": {
    "submitter": { "kind": "principal" },
    "other":     { "kind": "principal", "distinctFrom": "submitter" },
    "script":    { "kind": "expression" }
  },
  "setup": [ { "request": { "method": "post", "route": "/groovy/submit",
                "auth": "$holes.submitter", "body": { "code": "{{holes.script.code}}" } },
              "capture": { "requestId": "body.id" } } ],
  "test":  { "request": { "method": "get", "route": "/groovy/status",
              "auth": "$holes.other", "query": { "id": "$requestId" } },
             "expect": { "status": 403 } }
}
```

**Hole vocabulary — closed, v1 (D3):**

| kind | draws | provides |
|---|---|---|
| `principal` | a bed principal alias; `distinctFrom: <hole>` forces inequality | the alias (usable wherever `$users.<alias>` is) |
| `expression` | a seeded arithmetic expression **with its known result** (the audit's generator-paired pattern, done right: the generator knows the answer, so `expect` can assert `result` exactly) | `.code`, `.result` |
| `unique` | a seed-derived discriminator string | the string |

Anything richer (OpenAPI-typed holes, string grammars) waits for demand — same ratchet as the
DSL itself. `templates/` sits beside `cases/` and `steps/`; templates may also use steps.

## Instantiation (runner)

- `peira run … --templates <dir>`: for each template, mint `INVARIANT_CASES_PER_RUN` instances
  (D1: pinned constant **5**, `constants.js` — resolving RFC §9's open question the way it
  leans: budgets invite knobs, knobs violate invariant 7).
- Determinism: hole draws come from a PRNG keyed by `(seed, template id, instance index)` —
  no shared RNG stream, so instances are independent of run order and of each other.
- Minted case identity: `CASE-<template-slug>-g<index>`; `from` carries the template's intent
  lineage plus `{template, seed, instance}` — every verdict names exactly how to remint it.
- Minted cases are **runtime artifacts, not files** (D2): the evidence log records each minted
  case in full (a `minted` event), and the same seed regenerates it bit-for-bit; committing
  generated cases would just be a cache with drift risk. (A future `--emit` dump flag is cheap
  if inspection ever wants files.)
- `peira validate --templates <dir>`: template schema + hole checks (unknown kind, reference
  to an undeclared hole, `distinctFrom` naming a missing or same-kind-impossible hole,
  `principal` holes exceeding the bed's principal pool).

## Compiler

`kind=invariant` sections now compile to a template (PR2 deferred this with a manifest note).
Contract prompt gains the template protocol: holes vocabulary, the "one template per invariant,
let the generators do the enumeration" posture. Gate: `template.schema.json` + hole static
checks; lineage mechanical; manifest records `templates: [ids]` per section.

## The gate demo (two invariants, one bug probed forever)

New tagged intent (`intent/invariants.md`), two sections:

1. **`result-isolation`** (`kind=invariant`) — RFC §4.2's own example, verbatim spirit: for all
   requests r, for all users u ≠ submitter(r): status(r) as u → 403. Against the fixture every
   minted instance **fails with 401** — five fresh probes of `BUG-2022-01` every run, minted
   from one sentence. The bug can never quietly slip out of coverage.
2. **`submit-accepts-any-valid-script`** (`kind=invariant`) — any principal, any generated
   expression: submit → 200 + id, and (bonus the expression generator makes possible) status
   eventually COMPLETED with **the exact known result**. Every instance passes — and asserts
   more than the 2022 corpus ever could, because the generator knows each script's answer.

Real-session compile of both sections is the gate experiment, PR2/PR3 style.

## Tests (offline)

| Suite | Asserts |
|---|---|
| `template-schema.test.js` | schema accept/refuse; unknown hole kind; `$holes.x` without a declared `x`; `distinctFrom` chains; template-with-step passes |
| `generator.test.js` | same (seed, template, index) → identical draws; different index → independent draws; `distinctFrom` honored on a 2-principal pool; expression generator's `.result` is actually correct for `.code`; pool-exhaustion refused at validate |
| `mint.test.js` | instantiation resolves holes everywhere (auth, whole-value, in-string); minted ids and `from.{template,seed,instance}` stamped; same seed → byte-identical minted set |
| `runner-templates.test.js` | against the fixture: isolation template mints 5 failing probes (401-vs-403, reason names the minted instance); submit template mints 5 passing instances incl. exact-result asserts; evidence carries `minted` events |
| `compile-templates.test.js` | canned-LLM template emission gated + mechanical lineage; invariant section no longer `generators-deferred`; manifest records templates |
| CLI | `validate --templates`, `run --templates` wiring; determinism CLI-level (two runs, same seed, fresh fixture → identical verdict sequences incl. minted) |

## Work order

1. `template.schema.json` + validate wiring + refusal tests.
2. `src/generate.js` (PRNG + hole generators) + tests.
3. Runner minting + CLI + tests against the fixture.
4. Compiler template protocol + canned tests.
5. Real compile of `intent/invariants.md` → gate results into the plan.

## Acceptance checklist

- [ ] Both invariant sections compile to gate-passing templates via the real session
- [ ] 5 instances per template per run; same seed → byte-identical minted cases and verdicts
- [ ] Isolation template: every instance fails 401-vs-403 (BUG-2022-01, probed fresh each run)
- [ ] Submit template: every instance passes, asserting exact generated results
- [ ] A failing minted case is re-runnable from its recorded (template, seed, instance) alone
- [ ] Full suite green offline; PR1–PR3 artifacts untouched

## Decisions folded in (flag if you disagree)

- **D1 — N per run = 5, pinned constant.** Resolves RFC §9's open question the way it leans.
- **D2 — minted cases are evidence, not files.** Reproducibility comes from the seed.
- **D3 — hole vocabulary closed at {principal, expression, unique}.** Grows by demand only.
