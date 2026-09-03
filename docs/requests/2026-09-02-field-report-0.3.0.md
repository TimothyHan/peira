# Peira 0.3.0 — field report and four proposals

**For:** TimothyHan/peira · **From:** the Payload CMS migration (BusinessIndex
multi-tenant platform), the consumer behind the token-principal request ·
**Context:** 0.3.0 was adopted as the API acceptance gate for that platform
the day it shipped: 17 intent sections, 23 hand-written cases, run locally
and in GitHub Actions. This report is what we hit while doing that.

## 1. Confirmation: the 0.3.0 request is satisfied

Everything asked for in the token-principal request works as specified,
verified against a live service, not by reading the docs:

| Behaviour | Observed |
| --- | --- |
| `login` principal, `send` as header (`JWT {{token}}`) and as cookie | four principals + a cookie variant; all role-scoped cases writable |
| login once per run | 5 principals used across 23 cases → exactly 5 login requests in the evidence |
| refused login → `error` for dependent cases, naming principal and status | `ERROR … login for $users.badLogin: POST /api/users/login returned 401` |
| redaction by value | a live token appears 0 times in `run.jsonl`; headers stored as `[REDACTED:…]` |
| `request.followRedirects: false` | `307` + `Location` assertable; a cookie session then gets `200` |
| static `token` principal (not requested, welcome) | used for the bogus-token negative case |
| `capture` in `setup` → `{{alias}}` in a later route | "staff cannot edit others" is one case, not two |

`validate` caught every mistake we made statically, with a fix in the
message. That is the property that made adoption a same-day decision.

## 2. Proposals, in order of how much they cost us

### P1 — Zero-LLM lineage binding (`peira stamp`, or `adopt --no-model`)

**Problem.** A hand-written case must carry `from: {intent, hash}` where
`hash` is the sha256-prefix of the *live* section body (`intent.js:26`).
`validate` refuses anything else (correctly). But the only documented way to
obtain that hash is `compile`/`adopt`, both of which need a model session.
Teams that want to start with the deterministic runner and add the compile
step later — or that write a case by hand because it is faster than
explaining it — have to reach into `dist/intent.js`. We did:

```js
import { loadIntentDir } from 'peira/dist/intent.js'   // not a public export
```

**Proposal.** A read-only command that stamps lineage mechanically:

```
peira stamp cases --intent intent            # fill/refresh from.hash for every case whose from.intent resolves
peira stamp cases --intent intent --check    # exit 1 if any case would change (CI)
```

Semantics: `from.intent` (a section id) is authored by the human;
`from.hash` is never authored, always stamped — the same invariant compile
already enforces ("stamped mechanically, never trusted from the model"),
extended to cases no model wrote. `--check` makes stale detection a CI gate
without a model. If `loadIntentDir`/`hashSection` were also exported from
the package root, tools like ours could stop importing from `dist/`.

**Why it fits the design.** Nothing about verdicts or the closed vocabulary
changes; it widens the authoring on-ramp without weakening lineage, and it
is the mechanical half of `adopt` split out.

### P2 — Same seed + persistent service state = self-collision (docs + a nonce)

**Problem.** `unique.*` is `hash(seed, caseId, key)` — deterministic by
design. A case that *creates* state ("staff posts an entry titled
`peira {{unique.title}}`") therefore fails its own second run against the
same database: the title's slug already exists. The first run passed; the
rerun reported a `fail`, which reads as a regression until you understand
it. `reset` is the intended remedy, but many services (ours included) have no
wipe endpoint, and a shared staging environment never will.

**Proposal, two parts.**
1. A paragraph in "Understanding seeds": *cases that create state need
   either a `reset`, a fresh seed per run, or a run-scoped discriminator;
   a fixed seed against an unreset service will collide with itself.* We now
   pass `--seed $(date +%s)` locally and `${{ github.run_id }}` in CI, which
   is what the CI section already recommends — the local half of that advice
   is what is missing.
2. Optionally, `{{unique.run.<key>}}`: derived from the run start (recorded
   in `run-start` so the evidence still reproduces it), for the setup-data
   discriminator only. Claims stay deterministic; only the incidental value
   varies per run. If this is judged to erode the replay guarantee, the doc
   paragraph alone is enough.

### P3 — An absence matcher (`{"$absent": true}`)

**Problem.** Some APIs express "denied" by omission. Payload's `/api/access`
returns only the permissions a user holds; `collections.users.create` is
simply not there for a non-admin. Subset matching cannot say "this key must
not exist", so the negative claim has to be inverted into a list of things
that *are* present — a weaker oracle than the promise ("editors cannot
create users") deserves.

**Proposal.** One matcher, in the closed vocabulary, standing alone like the
others: `{"$absent": true}` — the path must not exist (distinct from `null`,
which asserts presence with a null value). Works in `expect.body` and
`expect.headers` (a header that must *not* be set — e.g. `x-frame-options`
after a CSP migration — is the same claim). Refused anywhere else.

### P4 — Two documentation nits

- `$alias` (whole-string, type-preserving) vs `{{alias}}` (spliced): both are
  in the interpolation table, but the first thing a new user writes is
  `"route": "/api/news/$theirs"`, which resolves to a literal. One line at
  the `request.route` row — *"use `{{alias}}` inside a route"* — would have
  saved our only false failure.
- The *weak oracle* warning is right, and noisy for deliberate status-only
  checks (a `404` on an HTML page). A per-case acknowledgement — e.g.
  `"oracle": "status-only"` next to `notes` — would let the linter stay strict
  for everyone else. Low priority; we added header assertions instead.

## 3. What we did not need

Multipart bodies (declared non-goal): uploads and the quota `413` remained in
the service's own Vitest suite, which is the right split. `--parallel` was
not exercised at 23 cases. No request for GraphQL or non-JSON responses:
HTML pages were assertable through status and headers, which was enough.

## 4. Reproduction, for any of the above

Repo: `payload-poc/api-tests/` in the consumer project — `bed.json`,
`intent/*.md`, 23 cases, and `scripts/stamp-lineage.mjs` (P1 done by hand).
`npm run test:api` runs it; the bed's `service` starts the app.
