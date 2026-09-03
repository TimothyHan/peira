# Peira — the vocabulary gets one source of truth (RFC 0004)

**Status:** accepted 2026-09-03, implementing | **Author:** Timothy Han (with Claude) | **Created:** 2026-09-03
**Origin:** the [second field report](requests/2026-09-03-field-report-0.4.0-html.md) — the RFC 0003 consumer put server-rendered pages under the same runner as their REST API (62 → 67 cases, 100 % declarative) and sent five observations. Extends [RFC 0001](DESIGN.md): amendments (H) and (I), one bug fix, one schema relaxation, one new command, and a structural change to how the vocabulary is documented.

**One sentence:** the report's real finding was not any of its five items but that the consumer learned what Peira can do by reading `dist/` — so the vocabulary now has one source of truth (described schemas and a matcher registry), `peira reference` renders it for the installed version, the `AGENTS.md` scaffold points agents there instead of restating a fraction of it, and a test keeps every copy equal; alongside, a dropped-cookie bug is fixed, a hand-written case may exist before it is stamped, `$contains` takes a list, and `$notContains` says "must not leak".

---

## 1. The finding underneath the report

The report is polite about it — *"everything worked around cleanly"* — but read the workarounds: text bodies discovered by reading `dist/http.js`; `loadIntentDir` imported from `dist/intent.js` because nobody said it was a root export; a placeholder hash invented to get past `validate`; `stamp`'s ability to fill a missing hash unknown because the schema forbade the case it fills. None of these is a missing feature. Each is a capability that existed and was written down nowhere an agent could read.

Peira is agent-native by design: the docs say the primary way to use it is through your agent, and `peira init` writes the `AGENTS.md` that agent reads. That file was five bullets of workflow and zero vocabulary — no matchers, no request keys, no auth forms, no `{{alias}}` rule, no `stamp`. It also said *"NEVER edit `cases/*.json` by hand"*, which since 0.4.0 contradicts a supported path, and an agent obeys that literally. Meanwhile the vocabulary lived in four hand-maintained copies — the schema (0 of 39 properties described, though the compile LLM reads it verbatim), the compiler's prose contract, REFERENCE.md, and the scaffold — with nothing keeping them equal. Three drifted in one week.

This RFC's structural change is therefore not "write more docs". It is: **one source, generated views, a test that fails when they disagree.**

## 2. One source of truth

- **Every schema property carries a `description`** — `case.schema.json` (39) and `bed.schema.json`. The vendored validator ignores unknown keywords, so this is free at the gate, and the compile LLM's contract improves without a word of prose changing.
- **`MATCHERS`** in `expect.ts` is the one list of the closed matcher vocabulary — key, form, meaning, amendment letter. The compiler contract renders its matcher section from it. The reference renders its table from it.
- **`COMMAND_NAMES`** in `cli/commands.ts` is the one command roster; `main.ts` dispatches from it and is typed against it, so an undeclared command is a compile error.
- **`peira reference`** renders the complete vocabulary of the *installed* version — schemas with descriptions, matchers, interpolation, bed and principal shapes, responses, verdicts, the CLI usage, environment — as markdown, from those sources alone. Docs in a user's repository freeze at whatever version scaffolded them; `node_modules/peira` is always the installed version, so this is what an agent reads on demand.
- **The `AGENTS.md` scaffold** is rewritten as a contract: the loop, plus `peira reference`, plus the rules the gate enforces — `{{alias}}` inside strings, no sleeps, `stamp` for hand-written cases, matchers stand alone, `from.intent` yours / `from.hash` never, `error` is not a bug. The same text lands in GETTING-STARTED §6 and on the site.
- **`test/reference.test.js`** is the drift guard: every schema property described; every matcher in the reference, in REFERENCE.md, in the compiler contract, and in the scaffold; every command dispatched, in USAGE, in the reference, and in REFERENCE.md; every request/expect key documented. A README lint was declined earlier and rightly — prose changes rarely. Vocabulary is different: when it drifts, an agent is wrong.

## 3. The five observations

**O5 — repeated `Set-Cookie` headers: a bug, not a doc gap.** Verified: three `Set-Cookie` headers reached the runner as one — the last. The Fetch spec keeps `Set-Cookie` as separate entries where every other repeated header is combined, and `Object.fromEntries` kept the final one. Fixed via `getSetCookie()` (fallback for Node < 18.14), joined with `", "` like every other repeated header, so `$contains` matches any one cookie. Documented in the `headers` row and the reference's Responses section.

**O3 — the placeholder hash: half right, and our half was the wrong one.** `stamp` already filled a missing hash; the schema required one, so `validate` refused the case before `stamp` could run. `from.hash` is now optional; a case with `from.intent` and no hash is **unstamped** — `validate` warns and names the command, `checkStale` reports it as its own category rather than as stale, `stamp --check` still exits 1 on it. `peira new` is deferred: a twelfth command whose whole job is a skeleton, when the cost was the placeholder.

**O1 — negation: `$notContains`, amendment (I).** No workaround existed for headers, and the open-redirect guard is a header claim. A flat leaf, string or list (none of), one diff per substring present. Not a composable `$not`: a matcher containing a matcher breaks the sole-key rule the gate and renderer rely on, and "every future matcher negated for free" is the open door the closed vocabulary exists to keep shut.

**O2 — `$contains` list: amendment (H).** All of; string still valid; one diff per missing substring. Accepted not because one team asked but because the alternative — documenting a regex lookahead in `bodySchema.pattern` as the way to say "contains A and B" — is the exact signal of a tool that is hard to use. **Decided alongside it: text bodies are a supported response type**, recorded in RFC 0001 §4.3. Same runner, same evidence, no new machinery; response testing, not UI testing.

**O4 — `service.before`: deferred, with the answer in the docs.** `service.command` runs in a shell, so `"./reset.sh && npm start"` already does it; one sentence in the `service` row says so. A second mechanism for data prep beside `bed.reset` waits for a second team that needs `PEIRA_SEED` in the prep step.

## 4. Acceptance criteria

```markdown
## The vocabulary has one source
<!-- peira: id=vocabulary-single-source kind=invariant -->
Every property in the case and bed schemas carries a description; every matcher and every
command appears in the reference, in REFERENCE.md, in the compiler contract (matchers), and in
the scaffold (matchers); a disagreement fails the suite.

## The reference is the installed version's
<!-- peira: id=reference-command kind=ac -->
`peira reference` prints markdown naming the installed version, every matcher, every command,
and every principal shape, generated from the schemas and registries — not from a hand-written file.

## Every cookie is kept
<!-- peira: id=set-cookie-kept kind=ac -->
A response with several Set-Cookie headers exposes all of them to `expect.headers`; `$contains`
matches any one.

## A hand-written case may exist before it is stamped
<!-- peira: id=unstamped-warns kind=ac -->
A case with from.intent and no from.hash passes `validate` with an `unstamped` warning naming
`peira stamp`, is not reported as stale, and is current after stamping.

## All-of and none-of are one case each
<!-- peira: id=contains-list-notcontains kind=ac -->
`{"$contains": [a, b]}` fails naming each missing substring; `{"$notContains": [x]}` fails naming
each present one; both are legal as header values.
```

## 5. Implementation

| area | change |
|---|---|
| `schema/*.json` | descriptions everywhere; `from.required` = `["intent"]` |
| `src/expect.ts` | `MATCHERS` registry; `$contains` list; `$notContains` |
| `src/reference.ts`, `src/cli/reference.ts`, `src/cli/commands.ts` | new |
| `src/validate-core.ts`, `src/validate-case.ts`, `src/stale.ts`, `src/cli/run.ts` | gate for the matchers; `unstamped` |
| `src/http.ts` | `getSetCookie()` |
| `src/compile.ts`, `src/render*.ts` | contract from `MATCHERS`; `<not contains>` |
| `src/cli/init.ts`, `docs/GETTING-STARTED.md`, site | the scaffold, three copies, one text |
| `docs/REFERENCE.md`, `docs/DESIGN.md` | matcher rows, CLI and Environment sections, text bodies, (H) (I) |
| tests | `reference`, `contains`, `set-cookie`, `unstamped` |
