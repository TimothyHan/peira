# Compile eval log

One row per `npm run eval:compile`. The point is the *trend*: gate pass-rate and green
verdicts should hold across prompt edits and model changes — a number that moves is the
signal to go read that run's report. Full reports and compiled artifacts live in
`.eval-runs/` (untracked); this log is the durable record.

`regressions` is the column to read: failures that are **not** on the named
`eval/expected-failures.json` list. Expected failures (the known 401-vs-403 bug, the bed's
control-flow gap) are real information but not news.

| date | model | contract | compiled | gate pass | cases | lineage | validation | verdicts (p/f/e) | regressions |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-31 | claude-opus-5 | 92d43e337f5d | 24 | 58.3% | 44 | ok | clean | 35/19/0 |
