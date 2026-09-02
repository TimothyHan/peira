# Peira — token principals (RFC 0002: authenticate the way real APIs do)

**Status:** accepted 2026-09-02 — §8 decided, implementing | **Author:** Timothy Han (with Claude) | **Created:** 2026-09-02
**Origin:** an inbound request from a consumer migrating a multi-tenant Payload CMS platform ([docs/requests/2026-09-02-token-principals.md](requests/2026-09-02-token-principals.md)); every factual claim in it was checked against `src/` and holds. Extends [RFC 0001](DESIGN.md) — amends invariant 9 and adds case-vocabulary amendments (E) and (F).

**One sentence:** a bed principal may declare *how to log in*, the runner obtains and attaches the resulting token itself, and cases keep saying `$users.<alias>` — the case vocabulary gains only a way to say "follow no redirects" and a way to hand a request a literal bad token.

---

## 1. Problem

`request.auth` supports exactly one credential scheme. `src/http.ts:38` builds `Authorization: Basic …` from a `{username, password}` principal, and that is the whole of it. Modern APIs overwhelmingly authenticate with a login request that returns a token, sent thereafter as a bearer-style header or a cookie. Against such an API — which is most of them — Peira cannot write a single role-scoped case, and role-scoped cases (isolation, ownership, access sets) are precisely the invariants the intent layer exists to state.

The 5/5 external-API result in `docs/findings/2026-08-29-external-api.md` was earned against an *unauthenticated* service. That number says nothing about the authenticated majority.

The consumer's alternatives were considered and are rejected for the reasons they gave: adding Basic to the service under test puts test scaffolding in the product and moves the limitation to every future consumer; a per-case login in `setup` repeats the login N times per run and copies the header template into every case. A principal is the right unit.

## 2. Fit with RFC 0001

This is not an assertion-power change, so §6's non-goal against a programmable assertion API is untouched. It divides into two kinds of change, and the distinction matters for where each is allowed to live:

- **The bed.** The `login` block describes *how the environment authenticates* — a fact about the service, which is exactly what the bed exists to state (the invariant-7 carve-out's reasoning, applied to credentials instead of timeouts). The case schema does not change for it.
- **The case vocabulary.** Two small additions go through §4.6's amendment path as (E) and (F), with the same closed-vocabulary discipline as A–D.

§155's growth rule — primitives are added from demonstrated demand — is met in the strictest sense: a real API, intent already written in prose, one exact blocker.

## 3. Design

### 3.1 Bed: a principal declares how it authenticates

A principal is one of three shapes. Exactly one; more than one is a static error.

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

  "svc": {
    "token": "sk_live_…",
    "send": { "header": "X-API-Key", "format": "{{token}}" }
  }
}
```

| shape | fields | what the runner does |
|---|---|---|
| **Basic** (unchanged) | `username`, `password` | `Authorization: Basic …` as today |
| **Login** | `login: {method?, route, body?, token, send}` | performs the login once, captures the token at `token`, attaches it per `send` |
| **Static** | `token`, `send` | attaches the literal per `send`; no request |

- `login.method` defaults to `post`. `login.route` must start with `/`. `login.body` may **not** reference `{{unique.*}}`: unique values are `(seed, caseId, key)` and a login belongs to a principal, not a case — there is no `caseId` to derive from. Refused statically.
- `login.token` is a capture path in the existing grammar (`extractPath` walks `{status, headers, body}` by dotted key), so `body.token`, `body.data.jwt`, and `headers.x-session` all work with no new code.
- The static shape is in v1, not a follow-up. It is trivial, it covers every API-key service without a login step, and a secret literal in `bed.json` is no new exposure — passwords live there today.

### 3.2 Attachment: `send`

Exactly one of:

- `{ "header": "<name>", "format": "<template>" }` — `format` must contain `{{token}}` (refused statically otherwise), and reuses amendment (C)'s interpolation. Covers `Authorization: Bearer …`, `Authorization: JWT …`, `X-API-Key: …`.
- `{ "cookie": "<name>" }` — sends `Cookie: <name>=<token>`.

### 3.3 Runner semantics

1. **Login is infrastructure, not a case.** It runs lazily on a principal's first use and is cached for the rest of the run. No case's `expect` ever sees the login response.
2. **The cache holds the in-flight promise, not the result.** `--parallel` is an in-process `Promise.all` pool over shared state; with a result cache, N workers reaching an uncached principal simultaneously would log in N times. Memoizing the promise makes "once per principal" true under any width. `--shard` is multi-process, so the guarantee is per process — stated as such in the AC.
3. **A failed login is an `error`, never a `fail`.** Non-2xx, or the `token` path absent from the response: every case that references the principal reports `error`, naming the principal and the login status. The run never got far enough to judge them — the `fail`/`error` split (invariant 1's corollary) holds. One `login` event per principal is appended to the evidence log with the response status.
4. **Ordering falls out of laziness.** `bed.reset` fires in `run.ts` before `runCases`; the first login happens after. A reset that recreates users is therefore safe.
5. **Drain keeps working, after one change.** `state.captureAuth[alias]` currently stores the resolved `Principal`; it must store the alias (or a resolved auth strategy) so `teardown.drain` can re-attach a token. Behavior for Basic beds is identical.
6. **Expiry inside a run is not handled in v1.** A mid-run 401 is a `fail` like any unexpected status. See §6.

### 3.4 Case vocabulary amendments

**(E) `request.followRedirects`** — boolean, default `true` (today's behavior: `fetch` with no `redirect` option follows). With `false`, the runner passes `redirect: 'manual'` and the case sees the 3xx itself. Node's undici returns the real response with headers, so amendment (D)'s `expect.headers` makes `location` assertable immediately: `expect.status: 307`, `expect.headers.location: {"$contains": "/login?next="}`. It also makes `capture: {"next": "headers.location"}` meaningful.

**(F) a literal token in `auth`** — `{"token": "<value>"}` as a fourth `request.auth` form, alongside `"$users.<alias>"`, `{username, password}`, and absent. It has no bed principal to consult, so it defaults to `Authorization: Bearer <value>`, and may carry its own `send` to target a cookie or a custom header instead (§8, decided). Purpose: negative tests. Without it, *"an invalid token → 401"* is not expressible for a token API — the Basic literal is Basic-only — and no security section can be written. The origin request's intent list happens not to need this; the next consumer's will.

Both are closed additions: `request` stays `additionalProperties: false`, and each new key admits exactly the shapes named here.

### 3.5 Redaction — invariant 9, revised

The origin request states that the token "is redacted at write time like `Authorization` already is." **This is false as the code stands, and it is the load-bearing part of the work.**

Redaction is key-based: `REDACTED_KEY = /^(authorization|cookie|set-cookie)$/i`, applied deeply. Under this proposal three things reach the evidence log that the current rule does not catch:

| value | where | caught today? |
|---|---|---|
| the token | login response body `{"token": …}` | no — `token` is not a redacted key |
| the token | a custom `send.header` such as `X-API-Key` | no — only `authorization` matches |
| the password | login request body `{"email", "password"}` | no — Basic never needed it; the password only ever lived inside the `Authorization` header |

Invariant 9 is therefore revised from key-based to **key-based plus value-based**:

- Keys: `authorization`, `cookie`, `set-cookie` (as today) plus `password` and `token`.
- Values: every token the runner has obtained or been given — captured at `login.token`, declared static, or supplied via amendment (F) — is registered with the evidence log, and any string **containing** it, anywhere in any event, has the occurrence replaced by its `[REDACTED:<sha256-prefix>]` tag at write time. Containing, not equal: a `format` of `Token id="{{token}}"` puts the secret inside a longer header value, and an echoing service puts it inside prose. Equality across events survives, as before. Values shorter than 16 characters are refused for registration (§8).

Value-based scrubbing is what makes the custom-header case safe without enumerating header names, and it is the only mechanism that covers a token echoed back inside some unrelated response body.

### 3.6 Validation

There is no bed schema today; `validate-core.ts` checks only that a referenced alias exists. This RFC introduces `schema/bed.schema.json` — the first — with `users.<alias>` as `oneOf [Basic, Login, Static]`, and `peira validate --bed` gains the static checks named above: exactly one shape; `route` begins with `/`; `token` is a syntactically valid path; exactly one of `send.header` / `send.cookie`; `format` contains `{{token}}`; no `{{unique.*}}` in `login.body`.

### 3.7 Determinism (invariant 8)

A token is incidental, like a captured id: it differs run to run, the claims do not, and verdicts remain a function of (cases, seed, service state). Template `principal` holes draw from `Object.keys(bedUsers)` — alias names only — so minted invariants work over token principals with no change to `generate.ts`.

## 4. Acceptance criteria

In Peira's own intent form; these are the implementation gate, to be compiled and run against the fixture.

```markdown
## Token principals log in once
<!-- peira: id=token-login-once kind=ac -->
Given a bed principal with a `login` block, when three cases reference it — including
under `--parallel 3` — the evidence log for that process contains exactly one `login`
event for that principal.

## Token is attached as declared
<!-- peira: id=token-send kind=ac -->
A request under a header principal carries `<header>: <format with token>`; a request
under a cookie principal carries `Cookie: <name>=<token>`; a request under a static
principal carries the literal. None carries `Authorization: Basic`.

## Failed login is an error, not a fail
<!-- peira: id=token-login-error kind=ac -->
When the login request returns non-2xx or the `token` path is absent, every case using
that principal reports `error`, naming the principal and the login status.

## Secrets never reach the evidence log
<!-- peira: id=token-redacted kind=invariant -->
For all evidence entries, neither the token value nor the login password appears in
plaintext — not in request headers, not in the login request or response body, not in
cookies, and not in any unrelated response body that echoes the token.

## An invalid token is refused
<!-- peira: id=token-literal-negative kind=ac -->
A request whose `auth` is a literal `{"token": "not-a-real-token"}` is answered with
401 by the fixture's protected route.

## Redirects are assertable when asked
<!-- peira: id=follow-redirects-false kind=ac -->
With `followRedirects: false`, a request to a redirecting route sees status 307 and can
assert `headers.location`; with the default, it sees the target.

## Beds without `login` behave exactly as before
<!-- peira: id=token-backcompat kind=invariant -->
For all existing beds and cases in the repo, verdicts and evidence are unchanged.
```

## 5. Fixture requirements

The in-repo fixture has no login or token endpoint. It gains: `POST /login` returning `{"token"}` for a known user and 401 otherwise; one protected route that accepts `Authorization: Bearer`, a configurable custom header, and a cookie, and returns 401 without a valid token; one route that echoes the token in its body (to exercise value-based scrubbing); and one route that answers 307 with a `Location`.

## 6. Non-goals

- **Token refresh or expiry inside a run.** The origin API returns `exp`; a `login.expires` capture path is a natural follow-up once a real run is long enough to need it.
- **OAuth authorization-code flows, PKCE, device flows.** Anything requiring a browser or a second party. A client-credentials grant is just a login request and is already covered.
- **Multipart bodies.** The origin request agrees; a JSON-only runner is a reasonable boundary.
- **Per-case login as a step.** Rejected above; the principal is the unit.

## 7. Implementation sequence

| file | change |
|---|---|
| `src/types.ts` | `Principal` becomes a three-way union; `BedConfig.users` typed accordingly |
| `src/http.ts` | `auth` becomes a resolved attachment `{headers}` rather than a `Principal`; `followRedirects` → `redirect: 'manual'` |
| `src/runner.ts` | login cache keyed by alias, memoized promise; `resolveAuth` returns an attachment; `captureAuth` stores the alias; `login` evidence event |
| `src/evidence.ts` | invariant 9 revised: `password`/`token` keys, plus a registered-value scrub list |
| `src/validate-core.ts`, `schema/bed.schema.json` | the first bed schema and the static checks in §3.6 |
| `schema/case.schema.json` | amendments (E) and (F) |
| `test/fixtures/server.js` | §5 |
| `docs/REFERENCE.md`, `docs/GETTING-STARTED.md`, `docs/DESIGN.md` | bed section, auth forms, invariant 9 text, amendments E/F recorded |

Roughly a day's work; the redaction extension is where the care goes.

## 8. Decisions (were open questions; settled 2026-09-02)

1. **Amendment (F) does both.** `{"token": "…"}` alone means `Authorization: Bearer …`; `{"token": "…", "send": {…}}` overrides, so negative tests exist for cookie- and custom-header services too.
2. **A login `error` does not short-circuit the run.** Each case reports its own `error`, consistent with how an unreachable `baseUrl` behaves; the summary line already collapses N identical reasons. The login is attempted once regardless (the cached promise is a rejection).
3. **Values under 16 characters are not registered for scrubbing** (`SECRET_MIN_LEN`). No real token is that short, and a registered `"1"` would mangle unrelated data. The `login` evidence event records `redaction: "registered" | "too-short"` so the refusal is visible rather than silent.

Two implementation facts that shaped the code, recorded so the RFC matches it: the vendored schema validator has no `oneOf` and takes `additionalProperties` only as a boolean, so "exactly one principal shape" and per-alias strictness live in `src/validate-bed.ts` while `schema/bed.schema.json` types the top-level keys; and the bed's top level stays permissive because `peira init` writes a `$comment` there and the back-compat criterion forbids breaking scaffolded projects. Login events are buffered and appended just before `run-end` in alias order, so the evidence file has the same shape serial or parallel.
