# Peira

*πεῖρα (peira) — Greek: trial, test, attempt. The root of "empirical": knowledge that exists only
because something was tried.*

Peira is an intent compiler for functional API testing. Human-owned acceptance criteria and
invariants compile (via an LLM, at authoring time only) into schema-gated declarative test cases
executed by a deterministic runner. Procedures may escape to generated code; assertions never do.
Every escape is telemetry that evolves the case DSL from evidence, not speculation.

**Status:** under active development. PR1 (case schema, deterministic runner, evidence log,
validation fixture) is in progress. See [docs/DESIGN.md](docs/DESIGN.md) for the full design
(RFC 0001) and [docs/plans/pr1.md](docs/plans/pr1.md) for the current implementation plan.

## v1 shape

```
intent/   human-authored acceptance criteria + invariants (markdown, the only source of truth)
cases/    compiled declarative tests (pure JSON, schema-gated, regenerable)
runner    deterministic execution → pass | fail | error verdicts + evidence JSONL
```

No LLM at runtime, ever. Same cases, same seed, same service state → same verdicts.

## License

MIT
