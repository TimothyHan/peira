# External-API gate: Peira against a service we did not build — PR6 results

*2026-08-29. The closed-loop breaker ([plan](../plans/pr6.md) §2): until now every run targeted
the in-repo fixture — a bed we wrote, testing a tool we wrote, from intent we wrote about
behavior we implemented. This experiment removes the last "we": the AUT is
`jsonplaceholder.typicode.com`, a public fake-REST service, reached over the real internet.
Artifacts: `experiments/jsonplaceholder/` (intent-compiled cases, manifest, run + Akela
evidence). Reproduce: `peira run experiments/jsonplaceholder --bed experiments/jsonplaceholder/bed.json --seed 42`.*

## Result

**5/5 pass, 0 error, first run, live network.**

- Intent: [`intent/jsonplaceholder.md`](../../intent/jsonplaceholder.md) — five hand-written
  ACs (fetch, 404, cross-resource reference, create-echo, collection shape).
- Compile: one session pass, 5 sections → 5 cases, zero refusals, zero steps (nothing needed
  procedure), lineage mechanical.
- Bed config: `{"baseUrl": "https://jsonplaceholder.typicode.com"}` — no principals, no drain
  probe. Nothing else was required, which is itself the finding: no fixture assumption had
  leaked into the tool. (One tooling nit surfaced and was fixed: the case loader now ignores a
  `bed.json` living beside cases, as it already did `compile-manifest.json`.)
- **`bodySchema`'s first real outing:** the collection-shape AC says "every element…" and the
  compiler correctly reached for a body schema (`{"type":"array","items":{…required id/userId/
  title…}}`) instead of enumerating elements — exactly the nudge the intent's phrasing and the
  contract's one-line doc intended.
- The 404 case carries the weak-oracle warning (`expect.body: {}`) — legitimate here (the
  service genuinely returns an empty object), and the lint's visibility is working as designed.
- Network honesty: a live third-party AUT makes runs `error`-prone by nature; this run had
  none, but the experiment stays out of CI regardless — committed evidence, not a green gate.

## Akela seam, exercised on the same run

`peira evidence --evidence <that run's JSONL>` (the log itself is a per-run artifact and is not
committed — regenerate it with `peira run experiments/jsonplaceholder --bed <jsonplaceholder bed>
--evidence run.jsonl`) → 5 `applied` records, each binding a live intent section (id + hash) to
the case and seed that validated it — the §4.8 grammar, produced deterministically from run artifacts alone.
Contradicted-record paths (triaged bug → service, drift → case) are covered by the offline
suite; untriaged failures and `error` verdicts export nothing by design (D4).
