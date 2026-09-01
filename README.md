<a href="https://timothyhan.github.io/peira/"><img src="https://raw.githubusercontent.com/TimothyHan/peira/main/docs/mark.svg" alt="Peira" width="40" height="38"></a>

# Peira *(PEER-uh)*

You write down what your API is supposed to do, in plain markdown — one heading per promise.
Peira turns that into test cases and runs them.

The writing step uses an LLM: once, on your machine, while you are authoring. The running step
never does. CI needs no API key — and any run replays exactly: same cases, same seed, same
service state, same verdicts.

When a run goes red, you are told which kind of red it is — the API genuinely did not do what you
said it would (`fail`), or the run never got far enough to find out (`error`). An unreachable
service can never be reported as a bug.

**[timothyhan.github.io/peira](https://timothyhan.github.io/peira/)** — the walkthrough, CLI
reference, and case anatomy, with a live look at the output. Also in Korean.

## In precise terms

Peira is an **intent compiler for functional API testing**. Human-owned acceptance criteria and
invariants, written in markdown, compile (via an LLM, at authoring time only) into schema-gated
declarative JSON test cases, executed by a deterministic runner. Procedure may escape to
generated code; **assertions never do**. Every escape is telemetry that evolves the case DSL
from evidence. When reality and intent disagree, an offline triage proposes — a human decides.

```
 intent/     acceptance criteria + invariants   ← human-authored markdown, the only source of truth
 cases/      compiled declarative tests         ← LLM-compiled, schema-gated, regenerable
 templates/  invariants with typed holes        ← the runner mints N seeded cases per run
 steps/      escape-hatch procedure code        ← typed contract, child-process, cannot assert
 runner      deterministic execution            ← zero LLM; pass | fail | error, never conflated
 triage      bug | drift | flake                ← offline LLM, schema-gated, proposals only
```

No LLM at runtime, ever. Same cases, same seed, same service state → same verdicts.

## Try the demo

The demo service and its bed live in the repo, so this one starts from a clone:

```bash
git clone https://github.com/TimothyHan/peira && cd peira
node test/fixtures/server.js 4477 &          # the demo service (a re-creation of a real production AUT)
node bin/peira.js validate cases --bed test/fixtures/bed.json
node bin/peira.js run cases --bed test/fixtures/bed.json --seed 42 --evidence run.jsonl
```

26 cases pass. Now break the service and watch triage adjudicate:

```bash
kill %1 && node test/fixtures/server.js 4477 --plant validation-message-text &
node bin/peira.js run cases --bed test/fixtures/bed.json --seed 42 --evidence run.jsonl
node bin/peira.js triage --evidence run.jsonl --intent intent   # needs the claude CLI logged in
```

Triage proposes an **intent-level diff** (the message text changed but the intent never pinned
it — drift), or a **structured bug finding**, or a **re-run prescription** — and applies
nothing. You decide.

## Use it on your own API

```bash
npm install -g peira
peira init          # bed.json, intent/example.md, agent instructions — never overwrites
```

**1. Point the bed at your service.** Edit `bed.json`. A `baseUrl` is often the whole config;
add `users` and `drain` only if your service needs them.

**2. Write your promises.** One `##` heading per acceptance criterion or invariant in
`intent/*.md`. Tagging with `<!-- peira: id=… kind=ac|invariant -->` is optional — ids derive
from headings, so an existing test plan ingests with zero edits.

**3. Compile.** `peira compile intent --out cases --bed bed.json` runs through your own Claude
session. Every candidate clears the same schema gate a hand-written case would, lineage is
stamped mechanically, and the manifest accounts for every section.

**4. Run.** `peira run cases --bed bed.json` gives you verdicts and an evidence log, with
credentials redacted at write time. `peira stats` reports DSL coverage and recurring escape
shapes.

**5. Keep cases in sync.** When intent changes, `peira validate --intent` flags stale cases and
`peira compile --section` regenerates exactly those. When runs fail, `peira triage` proposes and
you adjudicate.

**6. Record the run.** `peira evidence --evidence run.jsonl --intent intent` writes it into the
evidence ledger. Passing sections log `applied`; adjudicated drift
logs `contradicted`, with your note verbatim. Sections earn trust across runs — `peira trust`
shows the standings.

## Measured, not promised

All of it against the in-repo bed and its original hand-written suite:

- The five-primitive DSL re-expressed **27/27** of the original hand-written specs — zero
  escape hatches, zero sleeps.
- Compiling the original test plan **verbatim** reproduced every hand-written behavior
  and surfaced **three intent/implementation divergences** the hand-written suite silently
  encoded — including one nobody had ever tested.
- One invariant sentence mints 5 fresh seeded probes per run; the known bug it guards can
  never rotate out of coverage.
- Triage over 33 pre-registered behavior shifts: **bug/drift confusion 12.1%**, drift
  detection 8/9, zero schema refusals or injection incidents across every live call.

**Full walkthrough (zero → local loop → CI): [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).**
Command and flag reference: `peira help`. Design: [docs/DESIGN.md](docs/DESIGN.md) (RFC 0001).
Experiments and findings: `docs/findings/`.

## Status

**v0.2.0.** TypeScript, shipping compiled JS with full type declarations.

- **Node ≥ 18.** One first-party runtime dependency — same author, itself dependency-free, so
  there is no third-party code on the trust path.
- **Compile and triage need the Claude Code CLI**, running on your own session. No API key,
  anywhere.
- **One service under test per run.**
- **Explicit non-goals:** UI testing, load testing, mocking, contract brokering.

## The name

*πεῖρα* (peira) — Greek: trial, test, attempt. The root of "empirical": knowledge that exists
only because something was tried.

## License

MIT
