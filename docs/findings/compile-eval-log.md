# Compile eval log

One row per `npm run eval:compile`. The point is the *trend*: gate pass-rate and green
verdicts should hold across prompt edits and model changes — a number that moves is the
signal to go read that run's report. Full reports and compiled artifacts live in
`.eval-runs/` (untracked); this log is the durable record.

| date | model | contract | sections | gate pass | cases | lineage | validation | verdicts (p/f/e) |
|---|---|---|---|---|---|---|---|---|
