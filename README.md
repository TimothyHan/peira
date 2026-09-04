<img src="https://raw.githubusercontent.com/TimothyHan/peira/main/docs/mark.svg" alt="Peira" width="64" height="60">

# Peira *(PEER-uh)*

**An intent compiler for functional API testing.**

[Website](https://timothyhan.github.io/peira/) · [Docs](https://timothyhan.github.io/peira/docs/)

[![tests](https://github.com/TimothyHan/peira/actions/workflows/test.yml/badge.svg)](https://github.com/TimothyHan/peira/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/peira.svg?color=cb3837)](https://www.npmjs.com/package/peira)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2018-5fa04e)](https://nodejs.org)

You write down what your API is supposed to do, in plain markdown. Peira turns that into test
cases and runs them.

The writing step uses an LLM: once, on your machine, while you are authoring. The running step
never does. CI needs no API key — and any run replays exactly: same cases, same seed, same
service state, same verdicts.

When a run goes red, you are told which kind of red it is — the API genuinely did not do what you
said it would (`fail`), or the run never got far enough to find out (`error`). An unreachable
service can never be reported as a bug.

## In precise terms

Human-owned acceptance criteria and invariants, written in markdown, compile into schema-gated
declarative JSON test cases via an LLM, executed by a deterministic runner.

```
  intent/*.md           acceptance criteria + invariants — the only source of truth
      │
      │  compile · LLM, at authoring time only
      ▼
  cases/*.json          declarative, regenerable, each traceable to the line it came from
      │
      │  run · zero LLM
      ▼
  pass | fail | error   the API broke a promise, or the run never got that far
      │
      │  on fail
      ▼
  triage                bug | drift | flake — proposals only, a human decides
```

No LLM at runtime, ever. Same cases, same seed, same service state → same verdicts.

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
session. Every case the model proposes is checked against the same schema a hand-written one
would be, the link back to its intent section is recorded by the tool rather than by the model,
and the manifest accounts for every section — including the ones it declined to compile.

**4. Run.** `peira run cases --bed bed.json` gives you verdicts and an evidence log, with
credentials redacted at write time. `peira stats` reports how much of your suite stays
declarative, and where cases keep falling back to code.

**5. Keep cases in sync.** When intent changes, `peira validate --intent` flags stale cases and
`peira compile --section` regenerates exactly those. When runs fail, `peira triage` proposes and
you adjudicate.

**6. Record the run.** `peira evidence --evidence run.jsonl --intent intent` writes it into the
evidence ledger. Passing sections log `applied`; adjudicated drift
logs `contradicted`, with your note verbatim. Sections earn trust across runs — `peira trust`
shows the standings.

## Try the demo

The demo service and its bed live in the repo, so this one starts from a clone:

```bash
git clone https://github.com/TimothyHan/peira && cd peira
node test/fixtures/server.js 4477 &          # the demo service — a re-implementation, used as a fixture
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

## Beyond the core loop

Two pieces sit outside the four stages above.

**`templates/`** — property-based testing, in the case vocabulary: you declare typed blanks, and the
runner mints fresh seeded cases from them every run.

**`steps/`** — when setup cannot be written as JSON, you write your own code and the runner
calls it. It can act on the service, but never decide a verdict.

Both are specified in full in [docs/REFERENCE.md](https://github.com/TimothyHan/peira/blob/main/docs/REFERENCE.md).

## Tested against the original suite

The service in this repo is a re-implementation, used as a test fixture. The 27 specs and the
test plan compiled below are the originals — written by hand, years earlier, for the service it
re-implements.

- The case vocabulary — `request`, `capture`, `expect` — re-expressed **27/27** of those specs,
  without dropping to custom code once and without a single sleep.
- Compiling the original test plan **verbatim** reproduced every hand-written behavior and
  surfaced **three divergences between intent and implementation** that the hand-written suite
  had silently encoded — including one nobody had ever tested.

Triage precision, performance baselines, and the rest: [docs/findings/](https://github.com/TimothyHan/peira/tree/main/docs/findings).

**Full walkthrough (zero → local loop → CI): [docs/GETTING-STARTED.md](https://github.com/TimothyHan/peira/blob/main/docs/GETTING-STARTED.md).**
Command and flag reference: `peira help`. Design: [docs/DESIGN.md](https://github.com/TimothyHan/peira/blob/main/docs/DESIGN.md) (RFC 0001).

## Status

**v0.6.1.** TypeScript, shipping compiled JS with full type declarations.

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
