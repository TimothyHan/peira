# rikki-tikki

An intent compiler for functional API testing. Design source of truth: `docs/DESIGN.md` (RFC 0001) and `docs/designs/intent-compiler-thesis-first.md` (approved build plan — thesis-first PR order). Findings live in `docs/findings/` as dated records; they are never edited after the fact, only superseded.

Conventions: zero-dependency Node ≥ 18; "case" = compiled test unit (CASE- ids, `cases/`), "spec" always means the 2022 ancestor's artifacts (apiTestTask); no LLM at runtime, ever; assertions stay declarative (a step that asserts is a schema violation); constants over config knobs.

## gstack skill routing

- Vague idea or "is this worth building" → `/office-hours`
- Turn intent into a precise spec → `/spec`
- Plan written, before code → `/plan-ceo-review` (scope/strategy), then `/plan-eng-review` (required gate)
- Bug or unexplained behavior → `/investigate`
- Feature ready for testing → `/qa` (report-only: `/qa-only`)
- Diff ready to land → `/review`, then `/ship`
- After shipping → `/document-release`; monitor with `/canary`
- Second opinion on anything → `/codex`
