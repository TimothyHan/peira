# Peira reference

The complete programmable surface. The DSL is deliberately **closed** — this document is
finite because the vocabulary is; anything not listed here is refused by the schema gate,
and growth happens by amendment (recorded in [DESIGN.md](DESIGN.md) §4.3), never by
extension hooks. Sources of truth: `schema/case.schema.json`, `schema/step.schema.json`,
and the code — if this document ever disagrees with them, they win.

## The case

A case is one JSON file. `id`, `from`, and `test` are required.

| key | meaning |
|---|---|
| `id` | `CASE-<kebab-slug>` — unique across the set (duplicates are refused) |
| `title` | optional human title, usually the acceptance-criterion text |
| `notes` | optional free text |
| `from` | lineage: `{intent, hash}` — which intent section, at which content hash, produced this case. Stamped mechanically at compile time, never trusted from the model. A hash that no longer matches the live section flags the case **stale**. Minted template instances add `{template, seed, instance}`. For a case written by hand, leave `hash` out: `validate` warns **unstamped** (not an error), and `peira stamp cases --intent intent` fills it without a model — `from.intent` is yours, `from.hash` never is. `--check` makes unstamped or stale a CI gate that exits 1. |
| `setup` | optional array of steps (request steps or registry-step invocations), run in order |
| `test` | exactly one request step — the claim under test lives here |
| `teardown` | optional `{"drain": true}` — after the verdict, the runner polls every id this case captured (via the bed's `drain` probe, under the credentials that captured it) until it reaches a terminal state |

## A request step

```json
{
  "request": { "method": "post", "route": "/orders", "auth": "$users.alice",
               "query": { "expand": "items" }, "body": { "note": "x {{unique.nonce}}" } },
  "capture": { "orderId": "body.id" },
  "pollUntil": { "until": { "body": { "status": "SHIPPED" } }, "timeoutMs": 10000 },
  "expect": { "status": 201, "headers": { "location": { "$contains": "/orders/" } },
              "body": { "id": { "$any": "string" } } }
}
```

| key | meaning |
|---|---|
| `request` | the HTTP request this step issues — its keys follow |
| `request.method` | `get \| post \| put \| delete \| patch` |
| `request.route` | must start with `/`. Inside a route use `{{alias}}` — a bare `$alias` is only the *whole* value; buried in a longer string it is literal text, and `validate` warns |
| `request.query` | optional object → query string |
| `request.body` | optional JSON body (skipped for `get`) |
| `request.auth` | four forms: `"$users.<alias>"` (a bed principal — Basic, login, or static token; see the bed), a literal `{"username","password"}` (negative Basic tests), a literal `{"token": "<value>"}` with optional `send` (negative token tests; defaults to `Authorization: Bearer`), or absent (anonymous) |
| `request.multipart` | `{fields?, files?: [{field, path, mimetype?, filename?}]}` — send multipart/form-data instead of a JSON body (never both). `fields` values are strings, or objects serialised to JSON as a convenience for APIs that accept a JSON part. `files[].path` is relative to the **cases directory**: an ordinary file in the repo, never inline bytes; `validate` fails if it is missing or over 256 KB. `mimetype` is explicit so a wrong-type refusal is a case. The evidence log records names and sizes, never content |
| `request.followRedirects` | default `true`. With `false` the step sees its own 3xx — `expect.status: 307` and `expect.headers.location` become assertable, and `capture: {"next": "headers.location"}` becomes meaningful |
| `capture` | `alias → response path`. Paths are dotted and rooted at `status`, `body`, or `headers` (e.g. `body.id`, `headers.location`). A path missing from the response fails the case, naming the path. |
| `pollUntil` | re-issues this step's request until `until` (an expect block) matches, at a pinned 100 ms interval, up to `timeoutMs` (default 10 s, or the bed's `timeouts.pollUntilMs`). Non-convergence is a **fail**. The declarative replacement for wall-clock sleeps, which are refused. |
| `expect` | the oracle — see below |

## `expect` — the oracle

Subset matching with Jest `toMatchObject` parity: objects match as subsets at every level,
arrays match index-wise with equal length, primitives match strictly (no coercion).

| key | asserts |
|---|---|
| `status` | exact status code |
| `headers` | response headers by name, **case-insensitive** (RFC 9110). Each value is a literal string or a matcher — anything else is refused statically. A missing header is a named diff. Repeated headers arrive joined with `", "` — `Set-Cookie` included (every cookie is collected) — so `$contains` matches any one value |
| `body` | subset match against the body. JSON bodies are parsed; **any other body — HTML, text, empty — is a string**, and `$contains` / `$notContains` are the oracle for it (`bodySchema` with `"type": "string"` applies too). Server-rendered React (Next.js and others) separates adjacent text expressions with `<!-- -->`, so `총 {n}건` arrives as `총 <!-- -->2<!-- -->건` and the visible text is not a substring of the response. Assert on text that comes from one expression, or on a stable attribute value — not on visible text that spans an interpolation. |
| `bodySchema` | a JSON-Schema subset the whole body must satisfy: `type`, `required`, `properties`, `additionalProperties`, `enum`, `items`, `pattern`, `anyOf` — for "every element has shape X" claims |

### The matcher vocabulary (closed)

| matcher | meaning |
|---|---|
| `{"$any": "string" \| "number" \| "boolean"}` | present, of that type |
| `{"$contains": "<substring>"}` or `{"$contains": ["a", "b"]}` | a string containing the substring — or **every** listed substring (all of; each missing one is its own diff). The `content-type` matcher, and the oracle for text bodies |
| `{"$notContains": "<substring>"}` or `{"$notContains": ["a", "b"]}` | a string containing **none** of them — "must not leak X". The open-redirect guard: `"location": {"$notContains": "evil.example"}`; the positive form alone is fooled by `https://evil.example/?back=/hub` |
| `{"$absent": true}` | the key (or header) must **not** exist. Distinct from `null`; refused as the whole body. The motivating shape is an access map that omits denied permissions — `GET /api/access` as an editor → `{"tenants": {"create": {"$absent": true}}}`: assert the omissions, not the grants. It is a different question from "can this user read what they should?", and in the field it found access-control bugs a suite of 140 positive checks had never asked about |
| `null` | present and exactly `null` |

Matchers stand alone (no extra keys) and work in `expect.body`, `pollUntil.until`, and
`expect.headers` values. There is no way to register a custom matcher — that is a feature
(see DESIGN.md §6); the vocabulary grows by amendment, evidenced by `peira stats` fallback
telemetry.

## Interpolation

| form | resolves to |
|---|---|
| `"$alias"` (the whole string) | the captured value, **type-preserving** |
| `"…{{alias}}…"` (inside a string) | `String(value)` spliced in, at any depth |
| `"$unique.<key>"` / `{{unique.<key>}}` | a seed-derived discriminator: `hash(seed, caseId, key)` — same seed → same value, no fixture files |
| `"$users.<alias>"` | a bed principal — legal **only** in a request's `auth` position |
| `{{{{` | escapes to a literal `{{` |

References resolve in requests and expected bodies/headers alike. An unresolvable reference
is caught statically by `validate`; at runtime it fails the case, never guesses.

## The bed — `bed.json`

The only place Peira learns about your service. Everything except `baseUrl` is optional.

| key | meaning |
|---|---|
| `baseUrl` | where the service answers; `--base-url` overrides per invocation |
| `users` | named principals — cases say `$users.alice`, never credentials. Three shapes, exactly one per alias; see **Principals** below |
| `reset` | `{url, method?}` — one wipe-state call before each run |
| `drain` | `{route, idParam, statusPath, terminal[]}` — how to ask the service whether an async job settled; powers `teardown.drain` |
| `timeouts` | latency-envelope **ceilings**: `{requestMs?, pollUntilMs?, drainMs?, stepMs?}`. Hitting one is an `error`, never a `fail`. The poll interval is pinned (determinism, invariant 8). |
| `service` | how `peira run` starts the app under test: `{command, cwd?, readyMs?, reuse?}`. The command runs in a shell, so data prep chains in: `"./reset.sh && npm start"` — the answer when the service has no wipe endpoint for `reset`. `reuse` (default true) uses an already-answering `baseUrl` as-is and never kills it; a server Peira started is killed — whole process group — when the run ends. Only `run` manages processes. |

### Principals

A bed alias is exactly one of these. The case vocabulary does not change for any of them: a
case says `$users.<alias>` and the bed decides what that means per environment.

```json
"users": {
  "alice": { "username": "alice", "password": "pw" },

  "staff": {
    "login": {
      "method": "post",
      "route": "/api/users/login",
      "body": { "email": "staff@example.com", "password": "demo1234" },
      "token": "body.token",
      "send": { "header": "Authorization", "format": "JWT {{token}}" }
    }
  },

  "svc": { "token": "sk_live_…", "send": { "header": "X-API-Key", "format": "{{token}}" } }
}
```

| shape | fields | the runner |
|---|---|---|
| **Basic** | `username`, `password` | sends `Authorization: Basic …` |
| **Login** | `login: {method?, route, body?, token, send}` | logs in **once per run** on first use (cached; once even under `--parallel`), captures the token at `token` — a capture path, e.g. `body.token` or `headers.x-session` — and attaches it per `send` |
| **Static** | `token`, `send` | attaches the literal; no request. API keys |

`send` is exactly one of `{"header": "<name>", "format": "<template containing {{token}}>"}` or
`{"cookie": "<name>"}` (sends `Cookie: <name>=<token>`). `login.method` defaults to `post`;
`login.body` may not reference `unique.*` (a login belongs to a principal, not a case).

A login that is refused (non-2xx) or whose `token` path is absent makes every case on that
principal an **`error`** — the run never got far enough to judge them — naming the principal
and the status. Token expiry inside a run is not handled: a mid-run 401 is a `fail` like any
other unexpected status. `peira validate --bed` checks every shape statically
(`schema/bed.schema.json` plus the rules a schema cannot say).

## Verdicts and exit codes

| verdict | meaning |
|---|---|
| `pass` | every assertion held |
| `fail` | an assertion did not hold (includes pollUntil non-convergence, missing captures, unresolved references) |
| `error` | infrastructure failed **before** an assertion could be judged (connection refused, timeout ceiling, drain that will not settle) |

The two failure kinds are never conflated. Exit codes: `0` all pass · `1` any fail/error
(also: validation refused the set, or the service never answered) · `2` usage error.
`--junit` maps pass/fail/error to `testcase`/`failure`/`error` losslessly.

## The evidence log — `run.jsonl`

Append-only JSONL, one object per event; one file = one run. Credential material is redacted
at write time to `[REDACTED:<sha256-prefix>]` — equality across events survives, secrets never
land. Two rules: **by key** (`Authorization`, `Cookie`, `Set-Cookie`, `password`, `token`), and
**by value** — every token the runner obtains or is handed is registered the moment it is
known, and any string containing it, in any event, has the occurrence replaced by the same tag.
The second rule is what covers a token under a custom header name or echoed back inside an
unrelated response body. Values under 16 characters are not registered.

| event | carries |
|---|---|
| `run-start` | `seed`, `baseUrl`, `cases`, `minted`, `version`; `filtered`/`casesTotal` under `--only`/`--grep`; `shard` under `--shard` |
| `login` | one per login principal used: `principal`, `route`, `status`, `elapsedMs`, `outcome` (`ok` \| `refused` \| `no-token`), `redaction` (`registered` \| `too-short`). Never the request or response body. Appended just before `run-end`, in alias order, so the file has the same shape serial or parallel |
| `minted` | a template instance in full — `(template, seed, instance)` regenerates it bit-for-bit |
| `case-start` | the complete case definition |
| `http` | every exchange: request `{method, route, query, body, headers}` and response `{status, headers, body, elapsedMs}`, with the poll `attempt` |
| `step` | a registry-step invocation: `reads`, `produces`, dropped outputs, `elapsedMs` |
| `case-verdict` | `id`, `verdict`, `reason?`, `diffs?`, `elapsedMs` |
| `drain-skipped` / `drain-complete` | teardown accounting |
| `run-end` | `counts`, `wallMs`, `httpMs` (Σ of exchange times — a total, not a partition) |

This file is the integration surface: triage reads it, `evidence` records it into the
ledger, `render` turns it into reports, and your dashboards may parse it too.

## CLI

Twelve commands; `peira help` prints every flag, and **`peira reference`** prints this entire
vocabulary for the installed version — what an agent reads instead of `dist/`.

| command | does |
|---|---|
| `init` | scaffold `bed.json`, an example intent, `AGENTS.md` (+ `CLAUDE.md` import), `cases/`; `--ci` adds a zero-LLM workflow. Never overwrites |
| `validate` | the gate: schema plus the static checks; `--intent` adds stale / unstamped / missing-section reporting |
| `run` | the deterministic runner: `--seed`, `--evidence`, `--only`, `--grep`, `--parallel`, `--junit`, `--shard`, `--watch` |
| `compile` | intent → cases through your Claude session; `--section` for targeted recompile; `--dry-run` to see what would compile and why not |
| `stats` | DSL coverage, recurring fallback shapes, and the **refusal balance** — per intent: cases, positive (expected status < 400), negative (≥ 400), negative-oracle (`$absent` / `$notContains`), with a line naming intents that test only the happy path; `--openapi` adds endpoint coverage |
| `triage` | a failed run's evidence → bug \| drift \| flake proposals, never applied |
| `evidence` | record an adjudicated run into the trust ledger (+ portable JSONL export) |
| `trust` | the ledger standings per intent section |
| `render` | one-way documentation: Given/When/Then markdown or a visual HTML run report |
| `adopt` | restructure an arbitrary document into tagged intent, with a content-preservation report |
| `stamp` | bind hand-written cases to intent without a model; `--check` is the CI gate for lineage |
| `reference` | the complete vocabulary of the installed version, as markdown |

## Environment

| variable | meaning |
|---|---|
| `PEIRA_CLAUDE_BIN` | the `claude` binary the model-facing commands spawn (default: `claude` on PATH). Point it at a canned-output script to exercise compile/triage/adopt with no model — the tool's own suite does |
| `NO_COLOR` | disables ANSI colour in CLI output |

## Programmatic use

The package root exports the deterministic half of the tool, so scripts and other tools need
never import from `dist/`: `loadIntentDir`, `hashSection`, `checkStale`, `planStamp`,
`applyStamp`, `validateCase`, `validateBed`, `runCases`, `matchExpect`, and the types. The
model-facing functions (`compile`, `triage`, `adopt`) are exported too and take an `llm`
transport, so they are testable with a fake — the tool's own suite does exactly that.

## The escape hatch — steps (procedure only, never assertions)

A registry step is generated code with a typed contract (`schema/step.schema.json`):

```json
{ "id": "STEP-sign-payload-001", "reads": ["payload"], "produces": ["signature"],
  "code": "<JS async function body: (inputs, ctx) => ({ signature })>" }
```

A case invokes it in `setup` only: `{"step": "STEP-sign-payload-001", "bind": {…}}`.
Invocations structurally **cannot** carry `expect` or `capture` — the claim being verified
stays in the declarative `test` (invariant 3). Produced values enter the capture namespace;
outputs a step did not declare are dropped and logged. Code runs in a spawned child process
under a pinned timeout, and every use is telemetry (`peira stats`) asking whether the DSL
is missing a primitive.

## Invariant templates — typed holes, minted per run

A `kind=invariant` intent section compiles to a template: a case shape with declared holes,
minted as 5 fresh concrete cases per run from seeded generators.

| hole kind | draws | referenced as |
|---|---|---|
| `principal` | a bed user (optionally `distinctFrom` another hole) | `$holes.<name>` (auth position) |
| `expression` | a generated input with a known expected result | `{{holes.<name>.code}}` / `{{holes.<name>.result}}` |
| `unique` | a seed-derived discriminator | `$holes.<name>` |

Every minted case lands in the evidence log in full; `(template, seed, instance)` reproduces
it exactly.
