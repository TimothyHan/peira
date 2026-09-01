<a href="https://timothyhan.github.io/peira/"><img src="https://raw.githubusercontent.com/TimothyHan/peira/main/docs/mark.svg" alt="Peira" width="64" height="64" align="right"></a>

# Peira *(PEER-uh)*

You write down what your API is supposed to do, in plain markdown — one heading per promise.
Peira turns that into test cases and runs them.

The writing step uses an LLM: once, on your machine, while you are authoring. The running step
never does. CI needs no API key — and any run replays exactly: same cases, same seed, same
service state, same verdicts.

When a run goes red, you are told which kind of red it is — the API genuinely did not do what you
said it would (`fail`), or the run never got far enough to find out (`error`). An unreachable
service can never be reported as a bug.

**[timothyhan.github.io/peira](https://timothyhan.github.io/peira/)** — the walkthrough, CLI reference, and case anatomy, with a live look at the output. Also in Korean.

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

## Quickstart (from a clone — the demo bed lives in the repo)

```bash
git clone <repo> peira && cd peira
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

## On your own API

1. Write `intent/*.md` — one `##` heading per acceptance criterion or invariant. Tag with
   `<!-- peira: id=… kind=ac|invariant -->`, or don't (ids derive from headings; an existing
   test plan ingests with zero edits).
2. Write a bed config: `{"baseUrl": "…", "users": {…}, "drain": {…}}` — users and drain only
   if your service needs them.
3. `peira compile intent --out cases --bed bed.json` — compiles through your own Claude
   session (`claude -p`); every candidate passes the same schema gate as a hand-written case,
   lineage is stamped mechanically, and the manifest accounts for every section.
4. `peira run cases --bed bed.json` → verdicts + evidence JSONL (credentials redacted at
   write time). `peira stats` reports DSL coverage and recurring escape shapes.
5. When intent changes: `peira validate --intent` flags stale cases; `peira compile --section`
   regenerates exactly those. When runs fail: `peira triage` proposes; you adjudicate.
6. `peira evidence --evidence run.jsonl --triage run-triage.json --intent intent` records the
   run into Peira's evidence ledger: passing sections log `applied`, adjudicated drift logs
   `contradicted` (with the verbatim note), and intent sections earn evidence-gated trust
   across runs — `peira trust` shows the standings. A portable JSONL export is written
   alongside.

## Measured, not promised (against the in-repo bed and its legacy suite)

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

v0.2.0. Written in TypeScript; ships compiled JS with full type declarations. One
first-party runtime dependency (same author, itself dependency-free: no third-party code on
the trust path), Node ≥ 18. Single AUT per run. Compile and triage require
the Claude Code CLI (they run on your session; no API key). UI testing, load testing, mocking,
and contract brokering are explicit non-goals.

## The name

*πεῖρα* (peira) — Greek: trial, test, attempt. The root of "empirical": knowledge that exists
only because something was tried.

## License

MIT
