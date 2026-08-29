# PR3 implementation plan — escape-hatch steps, fallback telemetry, `peira stats`

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.5/§4.6/§7. One PR at a time; PR4+ stay at
RFC §7 resolution. Proves: **the DSL-evolution loop closes** — procedure can escape the DSL,
assertions cannot, and every escape is recorded demand.*

## Goal

Three deliverables, one discipline:

1. **Steps** — generated procedure code with a typed contract: reads named values from
   `runtimeData`, produces named values back, **asserts nothing**. Runs in a child process.
2. **Fallback telemetry** — every emitted step carries a normalized shape signature; the
   compile manifest records each escape as demand evidence.
3. **`peira stats`** — DSL coverage (fraction of the suite that is fully declarative — the
   suite's health headline) and recurring fallback shapes (the DSL's evidence-backed roadmap).

## The demand problem (and the planted fossil)

The 2022 corpus needed zero escapes (audited, then confirmed by PR2's compile). Telemetry
launching against an empty log proves nothing. So PR3 plants one **legitimate, exclusive**
demand: the fixture gains a `POST /secure/echo` endpoint requiring an HMAC-SHA256 signature
over the payload — computable by no day-one primitive, untouched by the 2022 corpus (exclusive
route; PR1/PR2 artifacts unaffected). A new tagged intent file describes the endpoint and its
(public, demo) shared secret; compiling it through the real session should force the model to
emit its first step — the fossil the telemetry launches with.

## Design

### Step definition (`steps/STEP-<slug>.json`)

```jsonc
{
  "id": "STEP-hmac-sign-001",
  "title": "compute HMAC-SHA256 signature over the payload",
  "reads": ["payload"],            // names taken from runtimeData
  "produces": ["signature"],       // names returned into runtimeData
  "code": "const { createHmac } = await ctx.crypto(); return { signature: ... };"
}
```

- `code` is a JS async-function body, inline (single reviewable, regenerable artifact).
- **The gate lints code deterministically:** assertion vocabulary (`expect(`, `assert`,
  `.should`) is refused — a step that asserts is a schema violation (invariant 3); `require(`
  / `import` / `process.` / `child_process` are refused — a step gets its inputs and the `ctx`
  helpers, nothing ambient.

### Step invocation — setup only, structurally assertion-free

```jsonc
"setup": [
  { "step": "STEP-hmac-sign-001", "bind": { "payload": "data {{unique.nonce}}" } }
]
```

- The case schema's setup items become `anyOf[request-step, step-invocation]`; an invocation
  admits only `step` + optional `bind` — no `expect`, no `capture`, refused by shape. `bind`
  resolves through the normal interpolation namespaces, then merges into the step's inputs.
- **`test` remains a request step.** The claim being verified stays in the case's declarative
  `expect`, always — invocations cannot appear where a verdict is decided (§4.5).
- Validator additions: the referenced step must exist (steps dir, default `steps/`, flag
  `--steps`); `reads` must be satisfiable from prior captures/bind/`unique.*`; `produces`
  extend the available-reference set for later steps.

### Execution (child process, honest isolation language)

`src/step-harness.js` — a separate node process per invocation: receives `{code, inputs,
baseUrl}` on stdin, builds the function with an `aut` fetch helper bound to the AUT base URL
plus a `ctx.crypto()` helper (node:crypto subset), writes `{outputs}` to stdout, dies. Pinned
`STEP_TIMEOUT_MS` in constants. Contract enforcement at the boundary: outputs not declared in
`produces` are dropped with a warning; missing declared outputs → the case **fails** with a
contract-violation reason (a generated artifact broke its contract — that is a fail, not an
infra error; the AUT was never at fault). Per RFC §4.5 this is isolation **by contract and
review** — the child process is a blast-radius reducer, not a security boundary, and the plan
says so plainly.

### Telemetry and `peira stats`

- Shape signature, computed not stored: `{reads (sorted), produces (sorted), skeleton}` where
  skeleton = the code token stream with identifiers/strings/numbers normalized (`I`/`S`/`N`),
  hashed — good enough to group "these N steps are the same missing primitive."
- `peira stats <casesDir> [--steps <dir>]` derives everything from the artifacts themselves
  (no side-log to drift out of sync): total cases, fully-declarative count, **coverage %**,
  steps with signatures, recurring shape groups (count ≥ 2) ranked — "the compiler telling you
  which primitive the DSL is missing, with evidence."
- The compile manifest records each step emission per section (`steps: [ids]`) — the durable
  escape history invariant 5 demands.
- **`compile --migrate` (promotion) is deferred** until telemetry shows a recurring shape for
  real — building the promotion mechanics against one planted fossil would be speculation, the
  exact failure §4.6 exists to prevent. The stats output is PR3's deliverable; the ratchet is
  built when demand recurs.

### Compiler integration

The contract prompt gains the escape protocol: the model may emit
`{"cases": [...], "steps": [...]}`; a step is emitted only when no declarative expression
exists; the same response protocol rules apply. Gate: step definitions validate against
`schema/step.schema.json` + the code lint; a case referencing a refused step is itself refused.

## Fixture addition (exclusive plant)

`POST /secure/echo` — basic auth; body `{payload: string, signature: string}`; valid iff
`signature === hmacSha256Hex(payload, "peira-demo-secret")` (shared demo secret, stated in the
intent — public by design; principals' passwords are never step inputs). Valid → 200
`{echo: payload, verified: true}`; bad/missing signature → 400 envelope. No existing route or
corpus behavior touched.

## Tests (offline; the one real compile is the gate experiment)

| Suite | Asserts |
|---|---|
| `step-schema.test.js` | step def schema accept/refuse; code lint refuses `expect(`/`assert`/`import`/`require`/`process.`; invocation with `expect` or `capture` refused by shape; unknown STEP id refused; unsatisfiable `reads` refused |
| `harness.test.js` | echo step runs in a child process; outputs merge; undeclared outputs dropped with warning; missing declared output → contract-violation fail; timeout kills the child; `aut` helper reaches the fixture and nothing else is provided |
| `runner-steps.test.js` | hand-written HMAC case green end-to-end against the fixture; step evidence event logged (no code text in evidence); a step crash → `fail`, fixture down during step's `aut` call → `error` |
| `stats.test.js` | coverage math on a mixed corpus; two same-shape steps group as recurring; pure-declarative corpus reports 100% |
| `compile-steps.test.js` | canned-LLM emission of case+step accepted through both gates; assertion-in-step candidate refused with the lint error in the manifest; manifest records `steps:` per section |
| fixture | `/secure/echo` verifies real HMAC, rejects bad signatures, exclusive-route regression (2022 corpus still green) |

## Work order

1. `schema/step.schema.json` + case-schema `anyOf` extension + validator wiring + refusal tests.
2. `src/step-harness.js` + runner invocation execution + tests.
3. Fixture `/secure/echo` + hand-written HMAC case (proves the runtime path before any model).
4. `src/stats.js` + `peira stats` CLI + tests.
5. Compiler escape protocol + canned-LLM tests.
6. Gate experiment: `intent/hmac-echo.md` compiled via the real session → the fossil.

## Acceptance checklist

- [ ] A step that asserts is refused at the gate; an invocation cannot carry `expect`/`capture`
- [ ] Hand-written HMAC case green via the child-process harness; PR1 corpus and PR2
      experiment artifacts byte-identical
- [ ] `peira stats` reports coverage and shape groups from artifacts alone
- [ ] Real compile of the HMAC intent emits a gate-passing step; the manifest records the
      escape; stats shows the fossil
- [ ] Full suite green offline

## Defaults I'll build with unless you object

- **Invocations in `setup` only** — `test` always stays a declarative request+expect (this is
  the structural enforcement of §4.5, not just a lint).
- **`--migrate` deferred** until a recurring shape exists in real telemetry (§4.6's own
  evidence bar applied to ourselves).
- **Demo secret is public in the intent** — signing needs a secret by nature; the demo uses a
  stated shared secret so principal credentials never become step inputs.
