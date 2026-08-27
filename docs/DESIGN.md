# Rikki-Tikki — design (RFC 0001: an intent compiler for API testing)

**Status:** Draft — scoping settled (API-only v1), no code yet | **Author:** Timothy Han (with Claude) | **Created:** 2026-08-27
**Origin:** apiTestTask (2022 — specification-driven API testing, the spec tier's ancestor) and Akela RFC 0003 (2026 — deterministic compilation over rectified context, the evidence loop this tool will eventually feed). Akela's own normative record is QABuddy RFC 0001/0002.

**One sentence:** Rikki-Tikki is an intent compiler for functional API testing — human-owned acceptance criteria and invariants compile (via an LLM, at authoring time only) into schema-gated declarative test cases executed by a deterministic runner; procedures may escape to generated code, assertions never do; and every escape is telemetry that evolves the case DSL from evidence, not speculation.

*"Run and find out." — the mongoose family motto, and the whole product.*

---

## 1. Thesis

Every "AI-native" testing tool surveyed on 2026-08-27 (Octomind, Momentic, Shiplight, Virtuoso, StepCI-with-AI, Keploy) puts AI to work as an **operator** over the same old artifacts: it writes Playwright code, heals selectors, suggests assertions. The artifact format itself is unchanged, so the trust problem is unchanged — a human still cannot tell, without reading generated code, whether the suite asserts what the team means.

Rikki-Tikki inverts the design around AI's actual failure profile:

- **Generation is cheap and untrusted** → the LLM compiles, and a deterministic schema gate catches hallucinated output. A model can argue with a prose instruction; it cannot argue with a validator.
- **Runtime nondeterminism is unacceptable** → no LLM step exists at execution time. Same cases, same service state → same verdicts.
- **Human judgment is the scarce resource** → it is spent only where it is irreplaceable: authoring intent, reviewing intent-level diffs, and adjudicating drift. Never on reading generated procedure code line by line.

The three mechanisms no surveyed tool ships, and this design's reason to exist:

1. **The oracle discipline** (§4.5) — procedure may escape the DSL; the assertion layer may not.
2. **Escape-hatch telemetry driving DSL evolution** (§4.6) — the fallback log is the DSL's roadmap.
3. **Drift triage at the intent level** (§4.7) — "bug or drift?" answered as a reviewable intent diff, not a silent self-heal.

## 2. Lineage — what each ancestor contributes

### From apiTestTask (2022), lessons promoted to requirements

| 2022 observation | Rikki-Tikki requirement |
|---|---|
| `teardown: { sleep: 1000 }`, hardcoded 100 ms waits → flaky | `pollUntil` is a day-one DSL primitive; wall-clock sleeps are a lint error in cases |
| "restart the app between runs" — shared service state | cases declare no dependence on prior runs; compiler emits unique payload discriminators per run |
| joi validation of the spec itself, loud errors | the case schema is the compilation gate: an invalid compile is *refused*, never patched |
| `$alias` runtime chaining setup → test | kept as-is — it is the essential primitive, proven |
| `toMatchObject` subset assertions | kept — subset match keeps cases terse and drift-tolerant on additive change |
| specs were JS despite a "JSON for everyone" pitch | cases are pure JSON; anything JSON cannot express is *by definition* an escape hatch (§4.5) |

### From Akela, mechanisms borrowed (not yet the engine — see §4.8)

- Addressable intent sections with stable ids (`<!-- rikki: id=… -->`, Akela-compatible tag grammar).
- Content-hash lineage: every case records which intent text, at which hash, it was compiled from.
- Manifests: every compile and every run says what it produced, what it dropped, and why.
- Evidence gates as arithmetic, thresholds as constants: no tunable knobs.
- The supervision geometry: **agents propose, determinism gates, the expert decides.**

## 3. Positioning

| Tool | Artifact | AI's role | What's missing vs this design |
|---|---|---|---|
| Octomind / Momentic | Playwright code / step scripts | operator (generate, self-heal) | UI-focused; oracle is code; heals at selector level, silently |
| Shiplight | intent YAML | author via MCP | no oracle discipline, no telemetry, no drift adjudication |
| StepCI | declarative workflow specs | assertion suggestions | no intent layer, specs are hand-maintained |
| Schemathesis | OpenAPI properties | none | syntactic invariants only — cannot express "results visible only to submitter" |
| Keploy | traffic-inferred suites | inference | no declared intent to reconcile against; describes what *is*, not what *should be* |
| Pact | consumer contracts | none | different problem (integration shape, not behavior) |

Rikki-Tikki competes on the synthesis and the discipline, not the ingredients.

## 4. Design

### 4.1 Three tiers, one loop

```
 ┌──────────────────────────────────────────────────────────────┐
 │ intent/  — acceptance criteria + invariants     AC- / INV-   │ ← human-authored markdown; the only source of truth
 ├──────────────────────────────────────────────────────────────┤
 │ cases/   — compiled declarative tests           CASE-        │ ← LLM-compiled, schema-gated, regenerable; reviewed as diffs
 │ steps/   — generated escape-hatch code          STEP-        │ ← typed contract, sandboxed, regenerable; every one logged
 ├──────────────────────────────────────────────────────────────┤
 │ runner   — deterministic execution → verdicts + evidence     │ ← zero LLM; every failure names its case, request, and diff
 └──────────────────────────────────────────────────────────────┘
        ↑ recompile on intent change          ↓ triage on failure (bug | drift | flake) — proposals only
```

### 4.2 The intent layer

A markdown folder (`intent/`). Every `##` is an addressable section, one acceptance criterion or invariant each:

```markdown
## Result isolation
<!-- rikki: id=result-isolation kind=invariant -->
Execution results are visible only to the user who submitted the request.
Invariant: for all requests r, for all users u ≠ submitter(r): GET status(r) as u → 403.

## Submit returns an id
<!-- rikki: id=submit-returns-id kind=ac -->
A valid authenticated submission is accepted and returns the registered request id.
```

- `kind=ac` compiles to one or more example cases.
- `kind=invariant` compiles to a **case template plus generators** — fresh concrete cases minted per run (§4.4). Humans vouch for a small set of invariants instead of reviewing thousands of generated assertions.
- Untagged headings derive ids from slugs, exactly as Akela's `derive` mode — an existing test plan (e.g. apiTestTask's `doc/test-plan.md`) plugs in with zero edits.

### 4.3 The case format

Pure JSON, schema-gated. The schema **is** the DSL definition — a primitive exists iff the schema admits it.

```jsonc
{
  "id": "CASE-result-isolation-001",
  "from": { "intent": "result-isolation", "hash": "a1b2c3d4e5f6" },   // lineage, mandatory
  "setup": [
    { "request": { "method": "post", "route": "/groovy/submit", "auth": "$users.alice",
                   "body": { "code": "$unique.expr" } },
      "capture": { "requestId": "body.id" } }
  ],
  "test": {
    "request": { "method": "get", "route": "/groovy/status", "auth": "$users.bob",
                 "query": { "id": "$requestId" } },
    "expect": { "status": 403 }                                        // subset semantics throughout
  }
}
```

Day-one primitives, chosen from the ancestor's scar tissue and nothing else: `request`, `capture`/`$alias` chaining, `expect` (status + body subset + optional JSON-schema match), `pollUntil` (predicate + timeout), `$unique.*` (per-run discriminators), `$users.*` (fixture principals). **That is the whole DSL at v1.** Everything else waits for telemetry to demand it (§4.6).

Three vocabulary amendments from the 2022-corpus audit ([findings 2026-08-27](findings/2026-08-27-dsl-audit.md)), normative for PR1: (A) `expect` bodies admit a closed matcher vocabulary — `{"$any": "string" | "number" | "boolean"}` and literal `null`; (B) `auth` takes three forms — `"$users.<alias>"`, a literal `{username, password}` (negative auth tests are the security section), or absent for anonymous; (C) `{{token}}` interpolation resolves at any depth and inside strings, in requests and expected bodies both — the ancestor's top-level-only substitution was a documented limitation. Two patterns are on the telemetry watchlist, deliberately not primitives: transient-state assertions and generator-paired unique payloads.

### 4.4 The compiler

`rikki compile` sends intent sections to an LLM (authoring time, never runtime) and accepts output only through the schema gate. Every compile writes a manifest: which intent sections, at which hashes, produced which cases; which compilations were refused and why; which fell back to escape hatches. A case whose `from.hash` no longer matches the live intent text is **stale** and flagged — regenerable artifacts are never hand-patched into divergence.

An OpenAPI document, where one exists, is an **optional compilation input** (decided 2026-08-27, §9): the compiler uses it to ground routes and payload shapes and to cross-check its own output before the schema gate, and PR4's generators may draw typed holes from it. Nothing requires it; compilation from intent alone is the baseline path.

Invariant sections compile to a template + generator pair: the template is a case with typed holes (`{user: any two distinct fixture principals}`, `{code: any valid expression}`); the runner instantiates *N* fresh cases per run from seeded generators (seeded → reproducible: a failing generated case is re-runnable by seed). Generation is deterministic given the seed; the seed is recorded in the run manifest.

### 4.5 The oracle discipline (the load-bearing rule)

**Procedure may escape the DSL. The assertion layer may not. Ever.**

When intent requires logic the DSL cannot express (orchestrating a concurrency window, computing a signature), the compiler emits a **step**: a sandboxed function with a typed contract — reads `runtimeData`, returns values into `runtimeData`, no ambient I/O beyond the provided HTTP client, no assertions. The case references it by id; the *claim being verified* stays in the case's declarative `expect`, diffable and reviewable at the intent level.

This is why the trust model survives generation: humans vouch for **claims**, which stay data; procedures are regenerable and merely have to terminate with the right shape. A step that asserts is a schema violation, refused at compile.

### 4.6 Escape-hatch telemetry → DSL evolution

Every emitted step is logged with a normalized shape signature (what it reads, what it produces, its structural skeleton). `rikki stats` reports:

- **DSL coverage** — fraction of the suite that is fully declarative (the suite's health headline).
- **Recurring fallback shapes** — "14 steps match shape `poll-with-backoff`" is the compiler telling you which primitive the DSL is missing, with evidence.

Promotion is a human edit to the schema (a new primitive), after which `rikki compile --migrate` re-expresses matching steps declaratively and the coverage metric rises. Demotion never happens — primitives are added from demonstrated demand, so the DSL only ratchets toward covering reality. This is Akela's promotion gate pointed at a grammar instead of a knowledge base, and it is the mechanism that keeps the DSL both minimal and sufficient — the failure mode that killed every committee-grown test DSL.

### 4.7 Drift triage

On a failed run, `rikki triage` (LLM, offline, proposals only) classifies each failure:

- **bug** — behavior contradicts intent → a structured finding (the issue-report deliverable falls out of the evidence for free: case, request, expected vs actual, intent section violated).
- **drift** — behavior changed but still satisfies intent (200 → 202 where intent says "accepted") → a proposed *intent-level* diff plus the recompiled case. The human approves or rejects the diff; the tool never self-heals silently. An approved drift updates intent (or confirms it), and lineage hashes make the recompile mechanical.
- **flake** — evidence insufficient to distinguish; re-run by seed is the first prescription.

Triage verdicts are recorded next to the run evidence. Because HTTP evidence is exact — every failure names its case, its request, and its diff deterministically — the blame-misattribution problem that dogs Akela's free-text domains does not exist here. **This is the reason API testing is the right first domain.**

### 4.8 Akela, eventually

Rikki-Tikki v1 keeps its own flat evidence log (JSONL: compiles, runs, verdicts, triage decisions) and does **not** depend on Akela — Akela is itself pre-1.0, and coupling two moving engines helps neither. The seam is kept deliberately: intent sections use the Akela tag grammar, evidence events are shaped like `applied`/`contradicted` (a passing case validates its intent section; a triaged bug contradicts the service; a triaged drift contradicts the *case*), and when both engines are stable, Rikki-Tikki becomes an Akela domain pack whose evidence channel is fully deterministic — the domain where Akela's open misattribution problem vanishes by construction.

## 5. Invariants (the things that do not change)

1. No LLM step at runtime. Compile and triage are the only model-facing surfaces, and both produce proposals gated by deterministic validation.
2. Intent is the only source of truth. Cases and steps are regenerable artifacts; a hand-edit that diverges from lineage is flagged, not silently accepted.
3. Assertions are declarative, always. A step that asserts is refused at the schema gate.
4. Every compile and every run writes a manifest — what was produced, what was dropped or refused, and why.
5. Every escape hatch is logged. Silent fallback is a bug in Rikki-Tikki, not a behavior.
6. Drift never self-heals. A case changes only through an approved intent-level decision.
7. Thresholds and caps are constants, not configuration.
8. Generated cases are seeded and reproducible; verdicts are a function of (cases, seed, service state).

## 6. Non-goals (v1)

- UI / browser testing (Octomind and Momentic's contested ground; enormous escape-hatch surface — would drown the telemetry signal v1 exists to prove).
- Load / performance testing.
- Mocking and contract brokering (Pact's problem).
- Traffic capture / inference (Keploy's problem; Rikki-Tikki declares what *should* be, not what is).
- LLM-as-judge assertions for fuzzy response content (a scoped, versioned exception may earn its way in later; it violates invariant 1 and needs its own RFC).
- A vector store, a ranking model, or any tunable scoring.

## 7. Implementation sequence

| PR | Scope | Proves |
|---|---|---|
| **PR1** | Case schema + deterministic runner + evidence log; hand-written cases only. Zero-dep Node ≥ 18, same as Akela. | the DSL's five primitives cover the ancestor's ground (§8) |
| **PR2** | Intent layer (tagged + derived markdown) + `rikki compile` with schema gate, lineage hashes, manifests | compilation fidelity is measurable |
| **PR3** | Escape-hatch steps (typed contract, sandbox) + fallback telemetry + `rikki stats` | the DSL-evolution loop closes |
| **PR4** | Invariant templates + seeded generators | semantic properties mint real cases |
| **PR5** | `rikki triage` (bug / drift / flake) + intent-diff proposals | drift adjudication at intent level |
| **PR6** | Akela pack + npm publish (`rikki-tikki` — verified free 2026-08-27) | the evidence loop generalizes |

## 8. Validation bed

Rikki-Tikki targets RESTful APIs generally; the bed is one AUT among any, and nothing in the tool may know which bed it points at — the difference is a base URL. (Decided 2026-08-27, after the boot check found no local Java runtime; [findings](findings/2026-08-27-dsl-audit.md).)

- **Primary bed: an in-repo fixture service** — a zero-dep Node HTTP server in `test/fixtures/`, implementing the observable semantics the 2022 corpus tests (basic auth with fixture users, submit/status resources, async jobs, a capacity-2 queue, PENDING → IN_PROGRESS → COMPLETED/FAILED). Owning the fixture also lets PR5 inject deliberate behavior shifts, Akela-experiment style.
- **Secondary bed, optional and for provenance: apiTestTask's groovy runner** — the 2022 take-home service the spec tier descends from; runs where Java exists (the 2022 CI ran it on `ubuntu-latest`).

The 2022 corpus — **27 executable specs** (32 files; 5 are traceability stubs, which Rikki-Tikki replaces structurally with lineage manifests) plus `doc/test-plan.md` — is the ground truth either way:

- **PR1 gate:** the five primitives (with the §4.3 amendments) re-express all 27 executable 2022 specs as cases, running green against the fixture with zero escape hatches and zero sleeps — every sleep becomes `pollUntil` (the flakiness fix the 2022 README apologized for, now enforced by lint). **Desk-audited 2026-08-27: 27/27 expressible; the audit is the schema's requirements list.**
- **PR2 gate:** compile the 2022 test plan's acceptance criteria (ingested via derive mode, zero edits) and measure fidelity against the hand-written specs: agreement rate, hallucinations refused by the gate, honest disagreements adjudicated by the author — who happens to be the ground truth's author too. One adjudication is pre-registered: AC 1.4 says 403 for cross-user access, spec `1-5` asserts the observed 401 — the intent/spec divergence the ancestor recorded nowhere, and exactly the case §4.7 exists to catch.
- **PR5 gate:** introduce deliberate fixture-behavior shifts and measure triage precision: bug/drift confusion rate is the headline number, because it is the number the whole category's trust depends on.

Per the Akela program's hardest-won lesson: instrument first, and let the harness's own evidence channel audit the harness. If a trainee ever files a bug against Rikki-Tikki itself, read it the same day.

## 9. Open questions

- Spec granularity for compiled invariants: N cases per run — constant, or budget-derived? (Leaning: small constant, seeded; budgets invite knobs, knobs violate invariant 7.)
- ~~Where OpenAPI fits: as an *input* to compilation (schema substrate for generators) it is pure upside; as a required artifact it excludes exactly the messy services that need testing most.~~ **Decided 2026-08-27: optional compilation input, never required.** When present, it feeds the compiler (route/shape grounding, hallucination cross-check) and the PR4 generators (typed holes drawn from schemas); its absence changes nothing about what compiles. No Rikki-Tikki mechanism may ever *require* it — the messy services that need testing most are the ones without one.
- Whether `rikki triage`'s bug findings should export Jira-shaped payloads in v1 or stay JSONL until a real consumer asks.
- ~~The word for a compiled unit: "spec" collides with the BDD lexicon's baggage; "case" is anonymous.~~ **Decided 2026-08-27: "case."** It is the word QA teams already use — a familiar term beats a fancy one — and it disambiguates for free: in this project's documents, "spec" now always means the 2022 ancestor's artifacts. Ids are `CASE-`, the folder is `cases/`.
