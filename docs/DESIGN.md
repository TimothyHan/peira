# Peira — design (RFC 0001: an intent compiler for API testing)

**Status:** v0.1 implemented — all six PRs landed 2026-08-29; §4.8's seam ships as `peira evidence` | **Author:** Timothy Han (with Claude) | **Created:** 2026-08-27
**Origin:** apiTestTask (2022 — specification-driven API testing, the spec tier's ancestor) and Akela RFC 0003 (2026 — deterministic compilation over rectified context, the evidence loop this tool will eventually feed). Akela's own normative record is QABuddy RFC 0001/0002.

**One sentence:** Peira is an intent compiler for functional API testing — human-owned acceptance criteria and invariants compile (via an LLM, at authoring time only) into schema-gated declarative test cases executed by a deterministic runner; procedures may escape to generated code, assertions never do; and every escape is telemetry that evolves the case DSL from evidence, not speculation.

*πεῖρα (peira) — Greek: trial, test, attempt. The root of "empirical": knowledge that exists only because something was tried.*

---

## 1. Thesis

Every "AI-native" testing tool surveyed on 2026-08-27 (Octomind, Momentic, Shiplight, Virtuoso, StepCI-with-AI, Keploy) puts AI to work as an **operator** over the same old artifacts: it writes Playwright code, heals selectors, suggests assertions. The artifact format itself is unchanged, so the trust problem is unchanged — a human still cannot tell, without reading generated code, whether the suite asserts what the team means.

Peira inverts the design around AI's actual failure profile:

- **Generation is cheap and untrusted** → the LLM compiles, and a deterministic schema gate catches malformed output. A model can argue with a prose instruction; it cannot argue with a validator. The gate secures *shape*, not meaning — the full trust boundary is schema gate + human case-diff review + measured compile fidelity (§8), stated as such rather than oversold.
- **Runtime nondeterminism is unacceptable** → no LLM step exists at execution time. Same cases, same service state → same verdicts.
- **Human judgment is the scarce resource** → it is spent only where it is irreplaceable: authoring intent, reviewing intent-level diffs, and adjudicating drift. Never on reading generated procedure code line by line.

The three mechanisms no surveyed tool ships, and this design's reason to exist:

1. **The oracle discipline** (§4.5) — procedure may escape the DSL; the assertion layer may not.
2. **Escape-hatch telemetry driving DSL evolution** (§4.6) — the fallback log is the DSL's roadmap.
3. **Drift triage at the intent level** (§4.7) — "bug or drift?" answered as a reviewable intent diff, not a silent self-heal.

## 2. Lineage — what each ancestor contributes

### From apiTestTask (2022), lessons promoted to requirements

| 2022 observation | Peira requirement |
|---|---|
| `teardown: { sleep: 1000 }`, hardcoded 100 ms waits → flaky | `pollUntil` is a day-one DSL primitive; wall-clock sleeps are a lint error in cases |
| "restart the app between runs" — shared service state | cases declare no dependence on prior runs; compiler emits unique payload discriminators per run |
| joi validation of the spec itself, loud errors | the case schema is the compilation gate: an invalid compile is *refused*, never patched |
| `$alias` runtime chaining setup → test | kept as-is — it is the essential primitive, proven |
| `toMatchObject` subset assertions | kept — subset match keeps cases terse and drift-tolerant on additive change |
| specs were JS despite a "JSON for everyone" pitch | cases are pure JSON; anything JSON cannot express is *by definition* an escape hatch (§4.5) |

### From Akela, mechanisms borrowed (not yet the engine — see §4.8)

- Addressable intent sections with stable ids (`<!-- peira: id=… -->`, Akela-compatible tag grammar).
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

Peira competes on the synthesis and the discipline, not the ingredients.

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

Runner facilities (2026-08-30, fundamentals gap-closure): `--only <id>` / `--grep <substr>` narrow a run to named cases (the whole set still validates — filtering narrows execution, never the gate); `--parallel <n>` runs cases on a bounded worker pool — determinism holds because every per-case input (seed-derived uniques, captures) is independent across cases, and per-case evidence buffers flush into the log in case order, so the file reads identically to a serial run's; `--junit <path>` emits JUnit XML for CI (pass/fail/error map to testcase/failure/error — the taxonomy survives the format); `peira stats --openapi <spec.json>` reports endpoint coverage — which endpoints of a declared API surface have no case — keeping OpenAPI strictly optional (§4.4).

Second tranche (2026-08-30, mature-runner review): `--shard <i>/<n>` takes the i-th interleaved slice of the deterministic order for CI fan-out — shards are disjoint and their union is exactly the unsharded run, which per-case seed independence makes trivially safe; `--watch` re-runs on change, mapped by *lineage* rather than an import graph — a case edit re-runs exactly those cases, bed/steps/templates edits re-run everything, and an intent edit re-runs **nothing** (the runner never reads intent) but re-checks staleness and names the affected cases, leaving recompilation a human act rather than a save hook with an LLM in the loop; the seed is pinned per watch session so re-runs are comparable. Bed-level `timeouts` is invariant 7's carve-out (§5). `bed.service` (`{command, cwd?, readyMs?, reuse?}`) lets `run` start the AUT itself — reuse an already-answering baseUrl by default, otherwise spawn a process group, await readiness, kill the group at the end; only `run` manages processes, and a not-ready service is a clean infra error, never a verdict.

### 4.2 The intent layer

A markdown folder (`intent/`). Every `##` is an addressable section, one acceptance criterion or invariant each:

```markdown
## Result isolation
<!-- peira: id=result-isolation kind=invariant -->
Execution results are visible only to the user who submitted the request.
Invariant: for all requests r, for all users u ≠ submitter(r): GET status(r) as u → 403.

## Submit returns an id
<!-- peira: id=submit-returns-id kind=ac -->
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

From the eng review (2026-08-27): cases may declare `teardown: { "drain": true }` — the runner polls every job id captured by the case until it reaches a terminal state (capped timeout), so a case that occupies the AUT's queue cannot poison the next case's transient-state assertions. This is the declarative replacement for the ancestor's `teardown.sleep`; wall-clock sleeps stay banned.

Two clarifications from the CEO review (2026-08-27): `$unique.*` values are **derived from the run seed** — invariant 8 applies to them, so re-run-by-seed reproduces the exact payloads; and body subset-matching follows Jest `toMatchObject` semantics exactly (index-wise subset for arrays), the ancestor's proven behavior.

Fundamentals gap-closure (2026-08-30), amendment (D): `expect` gains a `headers` block — response-header assertions by name (case-insensitive per RFC 9110), values a literal string or a matcher — and the matcher vocabulary gains `{"$contains": "<substring>"}` (string containing the substring; a `content-type` assertion is useless against charset suffixes without it). Header values that are neither a string nor a matcher are refused statically; the vocabulary stays closed.

Token principals ([RFC 0002](RFC-0002-token-principals.md), 2026-09-02), amendments (E) and (F): `request.followRedirects` (boolean, default true) — with `false` the runner passes `redirect: 'manual'` and the case sees its own 3xx, so a redirect is assertable through amendment (D)'s `expect.headers.location`; and `auth` gains a fourth form, a literal `{"token": "<value>"}` with an optional `send`, defaulting to `Authorization: Bearer` — the negative test for a token API, which the Basic literal cannot express. The bed change that motivates them (a principal may declare `login` or a static `token`) is environment description under the invariant-7 carve-out's reasoning and touches no case vocabulary.

First field report ([RFC 0003](RFC-0003-field-report-0.3.0.md), 2026-09-02), amendment (G): `{"$absent": true}` — the key or header must not exist. Distinct from `null` (present, null-valued); standing alone like every matcher; refused as the whole body. Subset matching could only state presence, and an API that expresses denial by omission forced the negative claim into a weaker positive one. **First day in the field ([note](requests/2026-09-02-field-note-0.4.0.md)):** rewriting one access-map case with `$absent` exposed two real access-control bugs that 140 in-process tests had not caught — not because those tests were wrong, but because every one of them asked "can this user read what they should?" and none had asked "what does this user hold that they shouldn't?" The matcher made a new kind of claim writable; the blind spot above is why it took a human's prose to ask for it.

Second field report ([RFC 0004](RFC-0004-field-report-0.4.0.md), 2026-09-03), amendments (H) and (I): `$contains` accepts a list — all of, one diff per missing substring — and `{"$notContains": …}` says a string contains none of the listed substrings. Negation as a flat leaf, not a composable `$not`: every matcher is a sole-key leaf the gate stops at and the renderer prints, and a matcher-containing-matcher is the open door the closed vocabulary exists to keep shut. **Decided with them: text bodies are a supported response type.** A non-JSON body arrives as a string and `$contains` / `$notContains` are its oracle — same runner, same evidence, no new machinery; server-rendered pages are half of what multi-tenant applications are. This is response testing, not UI testing (§6): no browser, no DOM.

### 4.4 The compiler

`peira compile` sends intent sections to an LLM (authoring time, never runtime) and accepts output only through the schema gate. Every compile writes a manifest: which intent sections, at which hashes, produced which cases; which compilations were refused and why; which fell back to escape hatches. A case whose `from.hash` no longer matches the live intent text is **stale** and flagged — regenerable artifacts are never hand-patched into divergence.

An OpenAPI document, where one exists, is an **optional compilation input** (decided 2026-08-27, §9): nothing requires it, and compilation from intent alone is the baseline path. But when one IS present, the cross-check is **mandatory, not advisory** (eng review OV-1): compiled routes, methods, and payload shapes that contradict the spec are refused like any schema violation — a semantic gate layered on the structural one. PR4's generators may draw typed holes from it.

Invariant sections compile to a template + generator pair: the template is a case with typed holes (`{user: any two distinct fixture principals}`, `{code: any valid expression}`); the runner instantiates *N* fresh cases per run from seeded generators (seeded → reproducible: a failing generated case is re-runnable by seed). Generation is deterministic given the seed; the seed is recorded in the run manifest.

### 4.5 The oracle discipline (the load-bearing rule)

**Procedure may escape the DSL. The assertion layer may not. Ever.**

When intent requires logic the DSL cannot express (orchestrating a concurrency window, computing a signature), the compiler emits a **step**: a function with a typed contract — reads `runtimeData`, returns values into `runtimeData`, no assertions — **isolated by contract and review**, not by an in-process sandbox (`node:vm` is not a security boundary, per Node's own docs; the PR5 implementation direction is a child process whose only network path is allowlisted to the AUT base URL). The case references it by id; the *claim being verified* stays in the case's declarative `expect`, diffable and reviewable at the intent level.

This is why the trust model survives generation: humans vouch for **claims**, which stay data; procedures are regenerable and merely have to terminate with the right shape. A step that asserts is a schema violation, refused at compile.

### 4.6 Escape-hatch telemetry → DSL evolution

Every emitted step is logged with a normalized shape signature (what it reads, what it produces, its structural skeleton). `peira stats` reports:

- **DSL coverage** — fraction of the suite that is fully declarative (the suite's health headline).
- **Recurring fallback shapes** — "14 steps match shape `poll-with-backoff`" is the compiler telling you which primitive the DSL is missing, with evidence.

Promotion is a human edit to the schema (a new primitive), after which `peira compile --migrate` re-expresses matching steps declaratively and the coverage metric rises. **Known blind spot (RFC 0003):** telemetry sees only what can escape. A claim that cannot be expressed *or* escaped — an absence, since steps cannot assert — never appears as a fallback; the author restates it as a weaker positive and moves on. Amendment (G) arrived as prose in a field report, not as a `stats` row. Some demand only arrives that way; the mechanism is necessary, not sufficient. Demotion never happens — primitives are added from demonstrated demand, so the DSL only ratchets toward covering reality. This is Akela's promotion gate pointed at a grammar instead of a knowledge base, and it is the mechanism that keeps the DSL both minimal and sufficient — the failure mode that killed every committee-grown test DSL.

### 4.7 Drift triage

Runner verdicts are `pass | fail | error`: `fail` means an assertion did not hold; `error` means infrastructure failed first (connection refused, DNS, timeout before any assertion) — the two are never conflated, because a triage that reads env-unreachable as a product bug is the misattribution trap Akela's experiments documented. `error` cases route to triage as flake/infrastructure, never as bug.

On a failed run, `peira triage` (LLM, offline, proposals only) classifies each failure:

- **bug** — behavior contradicts intent → a structured finding (the issue-report deliverable falls out of the evidence for free: case, request, expected vs actual, intent section violated).
- **drift** — behavior changed but still satisfies intent (200 → 202 where intent says "accepted") → a proposed *intent-level* diff plus the recompiled case. The human approves or rejects the diff; the tool never self-heals silently. An approved drift updates intent (or confirms it), and lineage hashes make the recompile mechanical.
- **flake** — evidence insufficient to distinguish; re-run by seed is the first prescription.

Triage reads AUT response bodies, which are untrusted input to its LLM — a hostile response could try to steer the verdict. The mitigation is structural, not prompt-based: triage output is schema-gated, proposal-only, and human-approved; no verdict acts on its own.

Triage verdicts are recorded next to the run evidence. Because HTTP evidence is exact — every failure names its case, its request, and its diff deterministically — the blame-misattribution problem that dogs Akela's free-text domains does not exist here. **This is the reason API testing is the right first domain.**

### 4.8 Akela, adopted (revised 2026-08-29; superseded "Akela, eventually")

Peira is an Akela domain, the way QABuddy is: akela is a first-party runtime dependency (same author, itself dependency-free — the old zero-dependency rule survives as "no third-party code on the trust path"). `peira evidence` records each adjudicated run through a spawn-isolated launcher (`src/ledger-engine.js`, AKELA_CWD): pass → `applied`; triaged **bug** → `applied` (the section did its job — it predicted correctly and caught the service violating it); triaged **drift** → `contradicted` with the adjudication note verbatim; flake/error/untriaged → nothing. Evidence is deduped per *section* per run (contradiction dominates a mixed section) so Akela's promotion arithmetic counts runs, not case volume. This is the domain where Akela's open misattribution problem vanishes by construction — every event traces to an exact HTTP diff.

**Surface rule (2026-08-29):** the engine is an implementation detail. Peira's user-facing vocabulary — docs, CLI help, console output, exported API — says "evidence ledger" (`--no-ledger`, `peira trust`, `deriveLedgerEvidence`) and never names the engine; ledger state lives under `.peira/`. The one visible artifact is the generated `akela.json` config at the project root, kept deliberately: it is inert to the user (generated, never edited), and renaming it would require an upstream engine change that hides for hiding's sake. This RFC is the internal record and speaks plainly.

## 5. Invariants (the things that do not change)

1. No LLM step at runtime. Compile and triage are the only model-facing surfaces, and both produce proposals gated by deterministic validation.
2. Intent is the only source of truth. Cases and steps are regenerable artifacts; a hand-edit that diverges from lineage is flagged, not silently accepted.
3. Assertions are declarative, always. A step that asserts is refused at the schema gate.
4. Every compile and every run writes a manifest — what was produced, what was dropped or refused, and why.
5. Every escape hatch is logged. Silent fallback is a bug in Peira, not a behavior.
6. Drift never self-heals. A case changes only through an approved intent-level decision.
7. Thresholds and caps are constants, not configuration. **Scoped carve-out (2026-08-30):** the bed may declare the *service's* latency envelope — `timeouts: {requestMs?, pollUntilMs?, drainMs?, stepMs?}` — because a timeout ceiling is a fact about the environment (exactly what the bed exists to state), and a pinned 5s ceiling misclassifies a slow-but-healthy service as `error`. Peira's own semantic constants stay pinned: the poll *interval* (load-bearing for invariant 8's determinism claim), mint counts, redaction prefix, lint caps.
8. Generated cases are seeded and reproducible; verdicts are a function of (cases, seed, service state) — **scoped caveat (eng review OV-3):** transient-state assertions additionally depend on the AUT's scheduling; against the fixture this is tamed by normatively pinned timing constants (job durations, poll interval — pinned in the [PR1 plan](plans/pr1.md)), and against arbitrary AUTs transient cases are honestly race-prone, which is why they sit on the telemetry watchlist. `$unique.*` values derive from the seed.
9. The evidence log redacts credential material by default. Key-based: `Authorization`, `Cookie`, `Set-Cookie`, `password`, and `token` values are stored as `[REDACTED:<sha256-prefix>]`. **Value-based (revised by [RFC 0002](RFC-0002-token-principals.md), 2026-09-02):** every token the runner obtains or is handed is registered at the moment it is known, and any string containing it, in any event, has the occurrence replaced by the same tag at write time — key-based rules cannot cover a token under a custom header name or echoed inside an unrelated response body. Equality across events survives; secrets never land in plaintext JSONL. Values under 16 characters are not registered (a registered `"1"` would mangle unrelated data).

## 6. Non-goals (v1)

- UI / browser testing (Octomind and Momentic's contested ground; enormous escape-hatch surface — would drown the telemetry signal v1 exists to prove).
- Load / performance testing.
- Mocking and contract brokering (Pact's problem).
- Traffic capture / inference (Keploy's problem; Peira declares what *should* be, not what is).
- LLM-as-judge assertions for fuzzy response content (a scoped, versioned exception may earn its way in later; it violates invariant 1 and needs its own RFC).
- A vector store, a ranking model, or any tunable scoring.
- Retries as policy. An auto-retried flake is a hidden verdict; flake is a *triage* classification a human sees, never a runner setting that makes it disappear.
- Response snapshot testing. A snapshot encodes what the service *currently does*; Peira's oracles state what the intent *requires*. Adopting snapshots would quietly reverse the thesis (it is traffic capture's failure mode in assertion form — see the Keploy line above).
- Mocking, stubbing, and spies. Black-box by construction: there is no in-process seam, and the absence of one is load-bearing — "the runner can't be sweet-talked" holds because neither a human nor an agent has a legal move that fakes the service. Downstream fakes are a bed-environment concern; contract-level doubles with verification are Pact's problem.
- Benchmarking and latency assertions. Per-case `elapsedMs` lands in evidence and JUnit as telemetry, but timing is never a verdict — a latency assertion is the first step into load testing, which stays out.
- A programmable assertion API (Chai/Jest `expect`, custom matchers). An open matcher set cannot be schema-gated, rendered to English, or diffed deterministically. Assertion power grows only by vocabulary amendment, evidenced by `stats` fallback telemetry (amendments A, C, D are the record of this working).

## 7. Implementation sequence

| PR | Scope | Proves |
|---|---|---|
| **PR1** | Case schema + deterministic runner + evidence log; hand-written cases only. Zero-dep Node ≥ 18, same as Akela. | the DSL's five primitives cover the ancestor's ground (§8) |
| **PR2** | Intent layer (tagged + derived markdown) + `peira compile` with schema gate, lineage hashes, manifests | compilation fidelity is measurable |
| **PR3** | Escape-hatch steps (typed contract, sandbox) + fallback telemetry + `peira stats` | the DSL-evolution loop closes |
| **PR4** | Invariant templates + seeded generators | semantic properties mint real cases |
| **PR5** | `peira triage` (bug / drift / flake) + intent-diff proposals | drift adjudication at intent level |
| **PR6** | Akela pack + npm publish (`peira` — verified free 2026-08-29) | the evidence loop generalizes |

## 8. Validation bed

Peira targets RESTful APIs generally; the bed is one AUT among any, and nothing in the tool may know which bed it points at. The per-bed surface is a **bed config** (eng review OV-7): base URL, a map of `$users` principals, and an optional reset hook (command or endpoint) run between suites — the minimum a real service needs that a fixture gets for free. Rate-limit handling stays out of v1. (Decided 2026-08-27, after the boot check found no local Java runtime; [findings](findings/2026-08-27-dsl-audit.md).)

- **Primary bed: an in-repo fixture service** — a zero-dep Node HTTP server in `test/fixtures/`, implementing the observable semantics the 2022 corpus tests (basic auth with fixture users, submit/status resources, async jobs, a capacity-2 queue, PENDING → IN_PROGRESS → COMPLETED/FAILED). Owning the fixture also lets PR5 inject deliberate behavior shifts, Akela-experiment style.
- **Secondary bed, optional and for provenance: apiTestTask's groovy runner** — the 2022 take-home service the spec tier descends from; runs where Java exists (the 2022 CI ran it on `ubuntu-latest`).

**Scope of the fixture (2026-08-31, from the first live compile eval).** The fixture implements the observable semantics *the corpus exercised* — not the language the real service ran. Its evaluator handles arithmetic (including seeded variable bindings and division by zero), explicit `throw`, malformed declarations, unknown-method calls, `sleep`-driven durations, and trailing string literals. It does **not** execute control flow or object construction: a loop, a conditional, an invoked function, or an instantiated class completes with a `null` result. That gap is deliberate — closing it means writing a Groovy interpreter in JavaScript, and the bed exists to have honest HTTP semantics, not to be a language runtime.

The consequence is worth stating plainly, because it will keep showing up: intent claims quantified over "any valid script" are **honestly under-served by this bed**, and cases compiled from them fail against it while being correct about the real service. That is drift between the bed and the intent, not a compiler defect — the compile eval carries these as a named expected-failure baseline (`eval/expected-failures.json`) so its verdict count reports *regressions* rather than a permanently red number. Two failures found the same way were genuine bed defects and were fixed instead: a thrown exception reported "no signature of method", and `def x =` was accepted with 200.

The 2022 corpus — **27 executable specs** (32 files; 5 are traceability stubs, which Peira replaces structurally with lineage manifests) plus `doc/test-plan.md` — is the ground truth either way:

- **PR1 gate:** the five primitives (with the §4.3 amendments) re-express all 27 executable 2022 specs as cases, running green against the fixture with zero escape hatches and zero sleeps — every sleep becomes `pollUntil` (the flakiness fix the 2022 README apologized for, now enforced by lint). **Desk-audited 2026-08-27: 27/27 expressible; the audit is the schema's requirements list.**
- **PR2 gate:** compile the 2022 test plan's acceptance criteria (ingested via derive mode, zero edits) and measure fidelity against the hand-written specs: agreement rate, hallucinations refused by the gate, honest disagreements adjudicated by the author — who happens to be the ground truth's author too. One adjudication is pre-registered: AC 1.4 says 403 for cross-user access, spec `1-5` asserts the observed 401 — the intent/spec divergence the ancestor recorded nowhere, and exactly the case §4.7 exists to catch.
- **PR5 gate:** introduce deliberate fixture-behavior shifts and measure triage precision: bug/drift confusion rate is the headline number, because it is the number the whole category's trust depends on.

Per the Akela program's hardest-won lesson: instrument first, and let the harness's own evidence channel audit the harness. If a trainee ever files a bug against Peira itself, read it the same day.

## 9. Open questions

- Spec granularity for compiled invariants: N cases per run — constant, or budget-derived? (Leaning: small constant, seeded; budgets invite knobs, knobs violate invariant 7.)
- ~~Where OpenAPI fits: as an *input* to compilation (schema substrate for generators) it is pure upside; as a required artifact it excludes exactly the messy services that need testing most.~~ **Decided 2026-08-27: optional compilation input, never required.** When present, it feeds the compiler (route/shape grounding, hallucination cross-check) and the PR4 generators (typed holes drawn from schemas); its absence changes nothing about what compiles. No Peira mechanism may ever *require* it — the messy services that need testing most are the ones without one.
- Whether `peira triage`'s bug findings should export Jira-shaped payloads in v1 or stay JSONL until a real consumer asks.
- Contract testing (noted 2026-08-29): provider-side, consumer-driven verification already falls out of the design — consumer-authored intent compiles to cases, the runner is the provider verifier, subset matching is the tolerant-matching rule, evidence is the proof. The consumer-side half has a tidy seam for later: every case's request→expect pair is a stub definition, so a mock provider could be *derived from the same case corpus* — one artifact serving both sides of the contract. Post-v1 RFC if a real consumer asks; brokering stays a non-goal (§6).
- ~~The project name: "rikki-tikki" was an explicit placeholder.~~ **Decided 2026-08-29: "Peira"** (πεῖρα — trial, test; the root of *empirical*). npm `peira` verified free the same day; the CLI binary is `peira`; intent tags use the `<!-- peira: ... -->` grammar.
- ~~The word for a compiled unit: "spec" collides with the BDD lexicon's baggage; "case" is anonymous.~~ **Decided 2026-08-27: "case."** It is the word QA teams already use — a familiar term beats a fancy one — and it disambiguates for free: in this project's documents, "spec" now always means the 2022 ancestor's artifacts. Ids are `CASE-`, the folder is `cases/`.
