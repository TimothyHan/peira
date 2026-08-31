# What the compile eval evaluates (and what it does not)

`npm run eval:compile` is easy to misread as a compiler quality score. It is not one. It
measures a **product of three things** — and holds two of them fixed to detect drift in the
third:

```
compiler (prompt + model)  ×  intent corpus  ×  validation bed
```

Change any one and the numbers move. What the eval is *for* is answering: **did a prompt edit
or a model change alter how the compiler handles a corpus we already understand?** That is
regression detection on a known body of work, which is exactly what the 254-test suite cannot
give you — the suite uses canned transports, so it proves the compile *plumbing* and the
schema gate, never the *quality* of what a live model returns.

## Whose property is each number?

Reading a run means knowing which of the three variables each figure actually describes.

| figure | property of | notes |
|---|---|---|
| gate pass-rate | **compiler** | over sections *meant* to compile; skips are excluded because skipping is a correct outcome |
| candidates refused / unparseable | **compiler** | the gate rejecting malformed output; should be ~0 |
| lineage integrity | **compiler** | stamped mechanically, so a miss is a Peira bug, not a model failure |
| validation cleanliness | **compiler** | static checks the schema cannot express |
| **regressions** | **compiler** | the headline: failures not on the named baseline |
| sections skipped, and why | **corpus** | see below — this says almost nothing about the compiler |
| case count | corpus × compiler | how many claims the document contains, and how finely they are decomposed |
| verdicts (pass / fail / error) | bed × compiler | a failure may be the *bed's* fault; that is what the baseline separates |

## Why the skip rate is a fact about the document

The repo's corpus is `intent/2022-test-plan.md`: a real take-home test plan that mixes prose
context, meta-commentary about the automation framework, and actual acceptance criteria in one
document. Ten of its twenty-four sections are correctly skipped because they state no service
behavior — "technology stack for the automation framework" is not a testable promise.

Intent written the way [GETTING-STARTED](../docs/GETTING-STARTED.md) prescribes — one
independently-changing promise per tagged section — would skip close to nothing. So a skip
rate of 42% here and 0% on a user's project says nothing about the compiler; it says the two
documents are different kinds of document. Read the skip *reasons* instead: they are where you
can see whether the compiler is exercising judgment or dodging work.

## What this eval does NOT measure

**Generalization** — how the compiler handles *a user's* intent: a domain it has never seen,
written in a style nobody taught it, against a service with its own semantics. A perfect score
here is consistent with poor performance on your API, because this corpus is one document
about one service.

The repo carries a deliberate second corpus for exactly that question:
`intent/jsonplaceholder.md`, described in its own first line as "intent for a service we did
not build." Its sections compile cleanly into valid cases against a public API with no fixture
behind it — which is real generalization evidence for the *compile* half.

**Known limitation:** those cases are currently compiled but **not executed**, because the eval
runs everything against the in-repo bed and they describe a different service. Scoring them
there would measure the harness, not the compiler, so they are reported as "not run." Running
them against the real `https://jsonplaceholder.typicode.com` would convert the strongest
available generalization signal from discarded to measured, at the cost of a network
dependency — worth doing as an opt-in flag, reported separately rather than blended into the
corpus verdicts.

## How to read a run

1. **Regressions first.** Zero means every failure is a named, understood one. Anything else
   is the reason you ran it.
2. **Then the compiler figures** — gate pass-rate, refusals, lineage, validation. These should
   be boringly stable across runs; movement is the signal.
3. **Then the bed figures** — verdict counts, with the expected-failure baseline subtracted.
4. **The skip reasons** are worth reading in full once per model change. They are the clearest
   window into the compiler's judgment.

The trend lives in [`docs/findings/compile-eval-log.md`](../docs/findings/compile-eval-log.md);
each run's full report and compiled artifacts land in `.eval-runs/` (untracked).

## The expected-failure baseline

`expected-failures.json` names failures that are **not** compiler defects — the bed's known
401-vs-403 bug, and its documented inability to execute control flow ([DESIGN.md](../docs/DESIGN.md)
§8). It matches on **diff signature, not case id**, because the model names cases freshly on
every compile; an id-keyed list would report the same known issues as new regressions on the
very next run. A failure counts as expected only when *every* one of its diffs matches, so a
case that breaks in a known way **and** a new way stays visible. A signature that matches
nothing is reported, so the list shrinks when a cause is fixed instead of rotting.

## Cost

One sequential model call per section on the pinned compile model — 24 sections took 347s on
`claude-opus-5` (2026-08-31). It spends your own Claude session, which is why it is opt-in and
not part of `npm test`. Point it at a small directory to exercise the pipeline cheaply:

```bash
node eval/compile-eval.js path/to/small-intent-dir
```

Runs against anything other than the repo's own `intent/` are kept out of the trend log.
