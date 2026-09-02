# Feature request: token-based principals (`users.<alias>.login`) in the bed

**For:** TimothyHan/peira · **From:** the Payload CMS migration (BusinessIndex
multi-tenant platform) · **Peira version evaluated:** 0.2.0 (`src/http.ts`,
`docs/REFERENCE.md` §"A request step", §"The bed")

## Summary

Peira's `request.auth` supports one credential scheme: HTTP Basic
(`src/http.ts:38` builds `Authorization: Basic …` from `$users.<alias>` or a
literal `{username, password}`). Most APIs we want to point Peira at —
including the one this request comes from — authenticate with a **login
request that returns a token**, then expect that token on every call as a
bearer-style header or a cookie. Today there is no way to express such a
principal, so every role-scoped case is unwritable. Proposal: let a bed
principal declare *how to log in*, and let the runner obtain and attach the
token itself. Cases keep saying `$users.staff`; nothing else in the DSL
changes.

## The consumer

A Payload CMS 3 API serving several client tenants. Roles: platform admin,
per-tenant editor, per-tenant staff. Authentication:

```
POST /api/users/login   {"email": "...", "password": "..."}
→ 200 {"token": "<jwt>", "exp": 1756800000, "user": {...}}
subsequent requests:  Authorization: JWT <jwt>      (or cookie payload-token=<jwt>)
```

What we want to write as intent (already written, in prose, in our migration
docs) and have Peira mint per run:

- For all tenants t and all users u not a member of t: `GET /api/<any t collection>` as u → 403.
- For all staff s and all posts p with author(p) ≠ s: `PATCH /api/<collection>/{p}` as s → 403.
- `GET /api/access` as each principal returns exactly the expected readable collection set.
- Anonymous `GET /api/announcements` → 403; anonymous `GET /api/stories` → 200 with only published documents.

Each of these is a `$users.<alias>` away from being a case. The only blocker
is that `<alias>` cannot be a token principal.

## Proposal

### Bed: a `login` block on a principal

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "users": {
    "staff": {
      "login": {
        "method": "post",
        "route": "/api/users/login",
        "body": { "email": "staff@kjasset.com", "password": "demo1234" },
        "token": "body.token",
        "send": { "header": "Authorization", "format": "JWT {{token}}" }
      }
    },
    "alice": { "username": "alice", "password": "pw" }
  }
}
```

- `login.route` / `method` / `body` — the request that mints a session. `body`
  may reference `{{unique.*}}` like any request body (not needed here).
- `login.token` — a capture path, same grammar as `capture` (`body.token`,
  `headers.set-cookie`, …).
- `login.send` — how the token is attached to subsequent requests. Two shapes:
  - `{ "header": "<name>", "format": "<template with {{token}}>" }` — e.g.
    `Authorization` / `JWT {{token}}`, `Authorization` / `Bearer {{token}}`,
    `X-API-Key` / `{{token}}`.
  - `{ "cookie": "<name>" }` — sends `Cookie: <name>=<token>`. Useful when
    the service only reads the cookie (this one accepts both).
- A principal has **either** `username`+`password` (Basic, unchanged)
  **or** `login`. Both present → static validation error.

### Runner semantics

1. **Login is infrastructure, not a case.** The runner performs each
   principal's login lazily on first use and caches the token for the rest of
   the run. Cases never see the login request in their own `expect`.
2. A login that fails (non-2xx, or `token` path missing) is an **`error`**
   for every case that references that principal — the run never got far
   enough to judge them — consistent with the `fail` / `error` split. The
   evidence log records one `login` event per principal with the response
   status; the token value is redacted at write time like `Authorization`
   already is.
3. **Determinism holds**: the token is incidental (like a captured id), the
   claims are unchanged, and the same seed + service state yields the same
   verdicts. Token expiry inside a run is not handled in v1; a 401 mid-run is
   a `fail` like any other unexpected status (document this).
4. `request.auth` keeps its three forms. `"$users.<alias>"` resolves to
   whichever scheme the alias declares. The literal form
   `{"username","password"}` stays Basic-only (negative-auth tests); a
   literal `{ "login": {...} }` is not needed.
5. `teardown.drain` runs "under the credentials that captured it" today —
   that continues to work, since the credentials are now "the alias", not a
   scheme.

### Validation / schema

- `bed.json` schema: `users.<alias>` becomes `oneOf [BasicPrincipal, LoginPrincipal]`.
- `peira validate --bed` checks: route starts with `/`, `token` is a valid
  capture path, exactly one of `send.header`/`send.cookie`, `format` contains
  `{{token}}` when `header` is used.
- Case schema: **no change**. Existing cases and beds are untouched.

### Acceptance criteria (in Peira's own intent form)

```markdown
## Token principals log in once
<!-- peira: id=token-login-once kind=ac -->
Given a bed principal with a `login` block, when three cases reference it,
the evidence log contains exactly one `login` event for that principal.

## Token is attached as declared
<!-- peira: id=token-send kind=ac -->
A request under a header principal carries `<header>: <format with token>`;
a request under a cookie principal carries `Cookie: <name>=<token>`. Neither
carries `Authorization: Basic`.

## Failed login is an error, not a fail
<!-- peira: id=token-login-error kind=ac -->
When the login request returns non-2xx or the token path is missing, every
case using that principal reports `error`, naming the principal and the
login status.

## Tokens never reach the evidence log
<!-- peira: id=token-redacted kind=invariant -->
For all evidence entries, the token value does not appear in request
headers, the login response body, or cookies.

## Beds without `login` behave exactly as before
<!-- peira: id=token-backcompat kind=invariant -->
For all existing beds and cases in the repo, verdicts are unchanged.
```

## Alternatives considered

- **Add Basic auth to the service under test.** A test-only auth strategy in
  Payload (~30 lines, env-gated). It unblocks us but puts test scaffolding in
  the product, and every future consumer would have to do the same. The
  limitation belongs to the client, not to every service.
- **Per-case login in `setup` + a `request.headers` field.** Expressible
  case by case, but it turns every case into a two-step, repeats the login
  N times per run, and the header template for the token would be copied
  into every case. A principal is the right unit.
- **API keys.** Payload can issue per-user API keys (`Authorization: users
  API-Key <key>`), still a custom header — it needs `send.header` anyway, so
  the proposal covers it too (a `login`-less static token variant could be a
  follow-up: `"token": "<literal>"`).

## Two smaller requests, lower priority

1. **`request.followRedirects: false`** (default `true`, today's behaviour).
   Server-rendered flows answer `307` with a `Location`; with `fetch`'s default
   the case sees the redirect *target* (a `200` login page) and cannot assert
   the redirect. With the flag, `expect.status: 307` and
   `expect.headers.location: {"$contains": "/login?next="}` become writable.
   Small, and it also makes `capture: {"headers.location"}` meaningful.
2. **Non-goal, stated for clarity: multipart bodies.** File uploads (and the
   quota `413` they trigger) stay in the service's own test suite; a JSON-only
   runner is a reasonable boundary and not a blocker.

## What we will do on our side once (1) lands

Compile `intent/*.md` for the four principals from our existing migration
docs, run against the local demo (`./demo.sh reset && ./demo.sh`) with
`--seed ${{ github.run_id }}` in CI, and use the run as the cutover
acceptance gate — the same role the previous black-box suite played for the
Drupal site this platform replaces.
