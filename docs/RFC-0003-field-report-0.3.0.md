# Peira — four responses to the first field report (RFC 0003)

**Status:** accepted 2026-09-02, implementing | **Author:** Timothy Han (with Claude) | **Created:** 2026-09-02
**Origin:** the [0.3.0 field report](requests/2026-09-02-field-report-0.3.0.md) from the consumer behind RFC 0002, who adopted 0.3.0 as a production API acceptance gate the day it shipped — 17 sections, 23 cases, local and CI — and verified every RFC 0002 claim against a live service. Extends [RFC 0001](DESIGN.md): amendment (G), one new command, one new static warning, one documentation correction, one declined proposal.

**One sentence:** a hand-written case can bind to its intent without a model (`peira stamp`), the oracle can say a key must *not* exist (`$absent`), the validator warns when a `$alias` is buried in a string, the seed docs admit that a fixed seed against an unreset service collides with itself — and a run-scoped discriminator is declined because invariant 8 says what it says.

---

## P1 — `peira stamp`: zero-LLM lineage binding

**Problem, verified.** A case must carry `from.hash`, the prefix of the live section's content hash, or `validate` refuses it — correctly. But nothing model-free writes that hash: `compile` and `adopt` both need a session. A team that wants to start with the runner and add the compiler later, or that writes a case by hand because it is faster than explaining it, has no supported path. The consumer wrote a script. Worse than they said: `validate --intent` treats a stale case as a **warning**, so there was no model-free CI gate for lineage either.

**One premise corrected.** The report says `loadIntentDir` "is not a public export" and imports it from `dist/intent.js`. It is — `loadIntentDir`, `hashSection`, and `checkStale` have been root exports since 0.1, verified from the packed 0.3.0 tarball. The docs never said so. Now they do (REFERENCE §Programmatic use).

**Design.** `peira stamp [casesDir] --intent <dir> [--check]`.

- `from.intent` is authored by the human and never touched. `from.hash` is never authored and always stamped — the invariant `compile` already enforces ("stamped mechanically, never trusted from the model"), extended to cases no model wrote.
- `planStamp` is the write-side of `checkStale`: it names every case whose hash is missing or differs from the live section. `applyStamp` rewrites exactly those files, in the format `compile` writes (two-space indent, trailing newline), preserving key order.
- A case whose `from.intent` names no section is an **error**, and a stamping run refuses entirely — `from.intent` is the human's to fix. A case with no `from.intent` is skipped: there is nothing to bind.
- `--check` writes nothing and exits 1 if any case would change or any intent is missing. This is the zero-LLM CI gate for lineage.
- `planStamp` / `applyStamp` are root exports, so tooling like the consumer's script can stop reaching into `dist/`.

## P3 — `{"$absent": true}`: amendment (G)

**Problem, verified.** Subset matching can only state what is present. An API that expresses denial by omission — an access map that simply lacks `collections.users.create` for a non-admin — forces the negative claim to be inverted into a list of what *is* there: a weaker oracle than "editors cannot create users" deserves.

**Design.** One matcher, closed like the others, standing alone: `{"$absent": true}` — the key must not exist. Distinct from `null`, which asserts presence with a null value. Legal as a body key's value and as a header value (`x-frame-options` after a CSP migration is the same claim). Refused with a value other than `true`, with extra keys, and as the whole `expect.body` (there is nothing for the body to be absent from). Renders as `<absent>`.

**A note on §4.6.** The growth rule says vocabulary is added from fallback telemetry. An absence claim cannot be expressed *or* escaped — steps cannot assert — so this class of demand never appears as a fallback. The consumer inverted the claim and moved on; this amendment exists only because a human wrote the report. Recorded in RFC 0001 §4.6 as a known blind spot of the mechanism: some demand only arrives as prose.

## P4a — a warning for `$alias` inside a longer string

**Problem, verified.** `"route": "/api/news/$theirs"` matches neither the whole-value form (`^\$name$`) nor the in-string form (`{{name}}`), resolves to the literal text, and `findTokens` cannot see it — so `validate` said nothing and the consumer's only false failure was this. A doc line was requested; a static warning is strictly better, since it reaches the reader who did not read.

**Design.** `warnEmbeddedRefs` walks route, query, and body; a `$name` inside a longer string yields a **warning** naming the `{{name}}` form. A warning, not an error: `$` starts ordinary text too (`costs $5` is not a reference — the pattern requires a letter). The doc line is added as well.

## P2 — same seed, same unreset service: self-collision

**Problem, verified.** `unique.*` is `hash(seed, caseId, key)` by design. A case that *creates* state fails its own second run against the same database, and the `fail` reads as a regression. "Understanding seeds" recommended a fresh seed for CI and said nothing about the local half.

**Accepted:** the paragraph. **Declined:** `{{unique.run.<key>}}`. Invariant 8 states that `$unique.*` values derive from the seed; a value derived from wall-clock time and merely *recorded* in `run-start` is logged, not reproducible, and the replay guarantee is the product. The consumer anticipated this and offered the doc paragraph as sufficient. It is.

## P4b — `"oracle": "status-only"`: deferred

A case-vocabulary key spent on silencing a lint. The consumer rates it low priority and solved it the right way — header assertions — which is what the warning exists to prompt. Revisit if a second consumer asks.

## Acceptance criteria

```markdown
## A hand-written case binds without a model
<!-- peira: id=stamp-binds kind=ac -->
Given a case with from.intent and no from.hash, `peira stamp` writes the live hash, preserves
every other byte of meaning (key order, intent), and the case then passes `validate`.

## Stamp is a CI gate
<!-- peira: id=stamp-check kind=ac -->
`peira stamp --check` exits 1 while any case would change or any intent is missing, 0 otherwise,
and writes nothing.

## Absence is assertable
<!-- peira: id=absent-matcher kind=ac -->
`{"$absent": true}` passes when the key or header is missing, fails naming the present value,
and is distinct from null.

## Absence is closed
<!-- peira: id=absent-gate kind=invariant -->
`$absent` with any value but true, with extra keys, or as the whole body is refused statically.

## Embedded references warn
<!-- peira: id=embedded-ref-warning kind=ac -->
A `$name` inside a longer string in route, query, or body yields one warning naming `{{name}}`;
the whole-value form yields none.
```

## Implementation

| file | change |
|---|---|
| `src/stamp.ts`, `src/cli/stamp.ts` | new; `main.ts`, `context.ts` (flag `--check`, usage), `index.ts` exports |
| `src/expect.ts` | `isAbsentMatcher`; body-key and header branches |
| `src/validate-core.ts` | `$absent` in `walkMatchers` and the header-value rule; whole-body refusal; `warnEmbeddedRefs` + a warnings channel through `checkStep` |
| `src/render.ts`, `src/render-html.ts`, `src/compile.ts` | `<absent>`; the model learns the matcher and the `{{alias}}` rule |
| `docs/DESIGN.md` | amendment (G); §4.6 blind-spot note |
| `docs/REFERENCE.md`, `docs/GETTING-STARTED.md` | matcher row, `from` row, Programmatic use, the seed paragraph, the `{{alias}}` line |
| site | matcher entry, `stamp` command, seed clause — both locales |
