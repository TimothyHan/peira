# Peira — uploads, the refusal balance, and one sentence about React (RFC 0005)

**Status:** accepted 2026-09-03, implementing | **Author:** Timothy Han (with Claude) | **Created:** 2026-09-03
**Origin:** the [third field report](requests/2026-09-03-field-report-0.5.0.md) — the RFC 0003 consumer upgraded to 0.5.0 in place (75 cases unchanged, 78 after applying `$notContains`, list-form `$contains`, and the shell-chained `service.command`) and sent the three things that remained. Extends [RFC 0001](DESIGN.md): amendment (J), one `stats` report, one documentation sentence. Supersedes the multipart scope note in [RFC 0002 §6](RFC-0002-token-principals.md).

**One sentence:** a case can send a file (`request.multipart`, fixtures as ordinary files in the repo, never inline bytes), `stats` reports how many cases per intent expect a refusal, and the docs say the one thing every server-rendered-React user will otherwise learn the hard way.

---

## Why three-for-three, when the last two rounds were not

The generality test from RFC 0004 still applies — *would a second team with a different stack hit this?* — and every item here passes it before it is asked: every React SSR user meets `<!-- -->`; every reviewer asks "do we test the failure paths?"; every API with an upload endpoint has its refusal paths exactly where Peira is best. The consumer pre-filtered. The parts that were specific are declined below.

## P2 — the React sentence

**Accepted.** React's server renderer separates adjacent text expressions with `<!-- -->` so hydration can split them; `총 {n}건` arrives as `총 <!-- -->2<!-- -->건`, and the visible text is not a substring of the response. `$contains` did the right thing; the author needs to know. One sentence in the Responses paragraph — written once in `src/reference.ts`, so it reaches `peira reference` and the docs.

**Declined:** the optional validator heuristic (warn when a `$contains` substring on a non-`/api/` route has a digit adjacent to non-ASCII letters). Keyed to CJK text, false-positive-prone, and the sentence prevents the trap.

## P1 — the positive/negative balance in `stats`

**Accepted, trimmed.** `stats` gains a per-intent table — cases, positive, negative, negative-oracle — and a total row. Classification is static:

- **positive** — `test.expect.status` < 400
- **negative** — `test.expect.status` ≥ 400
- **negative-oracle** — the test's `expect` contains `$absent` or `$notContains`, whatever the status: a denial expressed inside a 2xx
- **unclassified** — no `test.expect.status` (pollUntil-only); shown only when non-zero

A dry run over Peira's own corpus classified 26 of 26 and already showed the skew the report describes (1 positive-only intent, 2 negative-only). When any intent is positive-only, `stats` says so in one line.

**Declined:** two of the proposed "refusal-in-2xx" sub-rules — `null` on "a principal key" (the tool has no notion of a principal key; not statically meaningful) and `bodySchema` with `additionalProperties: false` (a shape claim, not a denial). **Declined:** the bed-level `minNegativeShare` threshold. Invariant 7 says thresholds are constants, not configuration; its carve-out covers environment description — timeouts, credentials — and a quality-policy knob is neither. Report the number; the reviewer reads it.

This is §4.6 telemetry, not a vocabulary change: no schema, no matcher, no new command.

## P3 — `request.multipart`: amendment (J)

**The record.** "Multipart bodies" appears as a non-goal in exactly one place: RFC 0002 §6, one line — *"a JSON-only runner is a reasonable boundary."* RFC 0001 §6 never lists it. This is a scope note reversed on demonstrated demand, which is what §4.6 prescribes — not a principle overturned.

**The design test.** Multipart is request-side. It adds no assertion power, so the oracle discipline (invariants 1, 3) is untouched; it is the same category as `followRedirects` (E) and the literal token (F). And the consumer's own argument is the decisive one: *once a team keeps a code suite beside Peira for uploads alone, the pressure to move everything there is real.* Uploads are not one platform's shape — every CMS, form backend, and attachment feature has type, size, and quota refusals, which are declarative denials stamped to a sentence.

**The shape**, as proposed, with two tightenings:

```json
"request": {
  "method": "post",
  "route": "/api/signatures",
  "auth": "$users.editor",
  "multipart": {
    "fields": { "tenant": "{{tenantId}}", "_json": { "firstName": "P" } },
    "files": [{ "field": "file", "path": "fixtures/8x8.jpg", "mimetype": "image/jpeg" }]
  }
}
```

- `multipart` and `body` are mutually exclusive; `validate` refuses both. At least one of `fields` / `files` must be present.
- `fields` values are strings, or objects — **an object is serialised to JSON as a convenience for APIs that accept a JSON part** (this consumer's `_json`); it is stated as exactly that, not as how form data generally works. Interpolation applies as everywhere else.
- `files[].path` is relative to the **cases directory**. `validate` fails when the file is missing, and **enforces a 256 KB cap** (`MULTIPART_FIXTURE_MAX_BYTES`) — the proposal suggested a cap; here it is a rule, because "small, reviewable fixtures" only holds if the gate holds it. Fixtures are ordinary files in the repo; a case never carries bytes.
- `mimetype` is explicit, so a case can send a file under the wrong type — which is what a MIME-refusal promise needs. `filename` defaults to the path's basename.
- **Evidence never carries bytes.** The `http` event records `multipart: {fields: [names], files: [{field, filename, mimetype, bytes}]}` in place of `request.body`.
- The runner builds a `FormData` (Node ≥ 18 global) and lets `fetch` set the boundary; no `content-type: application/json`.

Because the new key carries a schema description, it appears in `peira reference` with no further work — the first time RFC 0004's structure pays for itself — and the drift test refuses to let it ship undocumented.

## Acceptance criteria

```markdown
## An upload is a case
<!-- peira: id=multipart-upload kind=ac -->
A case with request.multipart sends fields and a fixture file as multipart/form-data; the
fixture's accepted upload → 201 naming the file; the wrong mimetype → 400; a file over the
fixture's quota → 413 — three promises, three cases, all declarative.

## Fixtures are files, small, and present
<!-- peira: id=multipart-gate kind=invariant -->
validate refuses multipart alongside body, a multipart with neither fields nor files, a
files[].path that does not exist relative to the cases directory, and a fixture over 256 KB.

## Evidence carries no bytes
<!-- peira: id=multipart-evidence kind=invariant -->
For a multipart request the evidence log records field names and per-file {field, filename,
mimetype, bytes}, and no content of any file.

## The balance is reported
<!-- peira: id=stats-balance kind=ac -->
peira stats prints, per intent and in total, cases / positive / negative / negative-oracle,
and one line naming how many intents test only the happy path.

## The React sentence is in the reference
<!-- peira: id=react-sentence kind=ac -->
peira reference's Responses section names the <!-- --> separator and says what to assert instead.
```

## Implementation

| area | change |
|---|---|
| `schema/case.schema.json` | `request.multipart` with descriptions; `request.body` description notes the exclusion |
| `src/constants.ts` | `MULTIPART_FIXTURE_MAX_BYTES` |
| `src/http.ts` | `multipart` option → `FormData`; no JSON content-type |
| `src/validate-core.ts`, `src/validate-case.ts`, `src/cli/{validate,run}.ts` | the four gate rules; `baseDir` threaded from the CLI's cases directory |
| `src/runner.ts` | resolve fields, read fixtures relative to `baseDir`, evidence summary without bytes |
| `src/render*.ts`, `src/compile.ts` | "with multipart (…)"; one contract line |
| `src/stats.ts` | `balance` per intent; `formatStats` table |
| `src/reference.ts`, `docs/REFERENCE.md` | the React sentence; `request.multipart` row; `stats` row |
| `docs/DESIGN.md`, `docs/RFC-0002-token-principals.md` | amendment (J); the §6 note marked superseded |
| `test/fixtures/server.js` | `POST /upload`: type and quota refusals |
| tests | `multipart`, `stats-balance`; reference test gains the React assertion |
