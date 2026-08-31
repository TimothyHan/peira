# Compile eval log

One row per `npm run eval:compile`. The point is the *trend*: gate pass-rate and green
verdicts should hold across prompt edits and model changes — a number that moves is the
signal to go read that run's report. Full reports and compiled artifacts live in
`.eval-runs/` (untracked); this log is the durable record.

`regressions` is the column to read: failures that are **not** on the named
`eval/expected-failures.json` baseline. Expected failures (the known 401-vs-403 bug, the bed's
control-flow gap) are real information but not news.

These numbers describe **compiler × this corpus × this bed** — not compiler quality in the
abstract, and not generalization to anyone else's intent. `eval/README.md` explains which
figure is a property of which, and why the skip rate says more about the document than about
the compiler.

| date | model | contract | compiled | gate pass | cases | lineage | validation | verdicts (p/f/e) | regressions |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-31 | claude-opus-5 | 92d43e337f5d | 24 | 58.3% \* | 44 | ok | clean | 35/19/0 | — \* |
| 2026-08-31 | claude-opus-5 | 92d43e337f5d | 14/14 (+10 skip) | 100.0% | 42 | ok | clean | 36/11/0 | 0 |

\* The first row is kept as history but is not comparable: it ran before the metric fix, so
its skips were counted as misses (it was in fact 14/14 = 100% of attempted), its 19 failures
still included 5 cases scored against the wrong service, and the expected-failure baseline
did not exist yet. In hindsight it too had zero regressions. Compare from row 2 onward.

Case counts move a little between runs (44 → 42) because compilation is a model call, not a
deterministic function — which is why the baseline matches on diff signature rather than case
id, and why the trend matters more than any single row.
