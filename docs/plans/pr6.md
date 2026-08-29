# PR6 implementation plan — Akela seam, external-API gate, npm publish

*2026-08-29. Derived from [RFC 0001](../DESIGN.md) §4.8/§7. The last PR of v1. Proves: **the
evidence loop generalizes** — beyond our own fixture, and into the shape Akela will one day
consume.*

## Goal

Three deliverables:

1. **The Akela seam** (§4.8): a deterministic exporter that reshapes a run (+ optional triage)
   into the flat `applied`/`contradicted` evidence grammar — Peira does NOT depend on Akela
   (both engines stay decoupled); it just speaks the shape.
2. **The external-API pre-publish gate**: everything so far ran against a bed we built — a
   closed loop. Before publishing, Peira must test one real API **we did not build**, from
   intent we write, compiled through the session, run over the real network.
3. **Publish**: README, packaging, `npm pack` verification, and the `npm publish` — the one
   step only the author can run.

## 1. The Akela seam (`peira evidence`)

`src/akela.js` + `peira evidence --run <run.jsonl> [--triage <proposals.json>] --out <jsonl>`.
Pure function of its inputs, one event per line:

```jsonc
{"event": "applied",      "intent": "<section id>", "hash": "<section hash>", "case": "CASE-…", "seed": 42}
{"event": "contradicted", "subject": "service", "intent": "…", "case": "…", "seed": 42, "via": "triage:bug"}
{"event": "contradicted", "subject": "case",    "intent": "…", "case": "…", "seed": 42, "via": "triage:drift"}
```

Mapping (RFC §4.8, verbatim semantics): a **passing case applies** its intent section; a
**triaged bug contradicts the service**; a **triaged drift contradicts the case** (the encoded
expectation, not the intent). `error` verdicts and untriaged failures emit **nothing** —
unadjudicated evidence is not evidence. Minted cases carry their template lineage through.
Deterministic: same inputs → byte-identical output (no timestamps; the seed is the run identity).

## 2. The external-API experiment (the gate that breaks the closed loop)

- **AUT: `jsonplaceholder.typicode.com`** (D1) — a public fake-REST service, CDN-backed and
  famously stable, no auth, no rate-key. We did not build it, and Peira knows nothing about it.
- `intent/jsonplaceholder.md` (hand-written, tagged): ~5 ACs — fetching an existing post
  returns 200 with its numeric ids and non-empty title; an unknown post id → 404; a post's
  comments all reference it; creating a post echoes the submission with a new id; the posts
  collection is non-empty and shaped consistently (a `bodySchema` case — the primitive's first
  real outing).
- Bed config: `{ "baseUrl": "https://jsonplaceholder.typicode.com" }` — no principals, no
  drain probe. If anything in the tool assumed the fixture, this is where it surfaces.
- Flow: compile via the session → validate → run over the live network → findings doc
  (`experiments/jsonplaceholder/`). Honest accounting: network runs are `error`-prone by
  nature; the pass/fail/error split exists exactly for this, and the findings say what happened.
- **Never in CI.** The experiment is committed evidence, not a green-gate dependency.

## 3. Packaging and publish

- **README rewrite**: what Peira is (three tiers, one loop), a 5-minute quickstart that works
  verbatim (fixture-based: validate → run → break something → triage), the measured story so
  far (27/27 re-expressed, compile fidelity, 12.1% confusion rate), honest status (v0.1,
  pre-Akela, single-AUT-at-a-time), pointer to the RFC.
- `package.json` → `0.1.0`; `files` whitelist already excludes docs/experiments/tests — verify
  with `npm pack --dry-run` (gate: the tarball contains bin/src/schema/README and nothing else).
- **DESIGN.md touch-up**: status line (Draft → v0.1 implemented), §4.8 marked shipped-as-seam.
- **`npm publish` is the author's action** (D3): everything staged so the publish is one
  command from your logged-in npm account; `0.0.1` placeholder gets superseded by `0.1.0`.

## Tests (offline)

| Suite | Asserts |
|---|---|
| `akela.test.js` | pass→applied with section hash; triaged bug→contradicted/service; drift→contradicted/case; error and untriaged fail → nothing; minted cases carry template lineage; byte-determinism across calls |
| CLI | `peira evidence` end-to-end on a recorded run + proposals; refuses a triage file whose run seed does not match the evidence |
| packaging | `npm pack --dry-run` file list pinned in a test (the tarball cannot silently grow) |

## Work order

1. `akela.js` + CLI + tests.
2. `intent/jsonplaceholder.md` + bed config → compile (session) → live run → findings.
3. README + version + pack verification + DESIGN touch-up.
4. Hand the publish command to the author.

## Acceptance checklist

- [ ] `peira evidence` emits deterministic applied/contradicted JSONL per the §4.8 mapping
- [ ] External API: intent we wrote, compiled by the session, runs against a service we did
      not build; verdicts + honest network notes in a findings doc
- [ ] `npm pack --dry-run` contents pinned; README quickstart works verbatim
- [ ] Full suite green offline; publish staged for the author

## Decisions folded in (flag if you disagree)

- **D1 — external AUT: jsonplaceholder.typicode.com** (stable, keyless; httpbin considered and
  passed over for flakiness, restcountries for schema churn).
- **D2 — publish version 0.1.0.**
- **D3 — the publish itself is yours**: I stage everything; you run `npm publish` once.
- **D4 — untriaged failures export nothing** — only adjudicated outcomes become evidence
  (matches Akela's evidence-gate ethos: no unvetted signal enters the loop).
