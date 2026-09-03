# Peira 0.4.0 — five observations from testing HTML pages, not just JSON

**For:** TimothyHan/peira · **From:** the consumer behind RFC-0003 · this
round grew the suite from 62 to 67 cases by putting the server-rendered
tenant hub (`/hub/{tenant}/…`) under the same runner as the REST API:
redirects, a forbidden state, board contents, an open-redirect guard, a
logout cookie. 67/67 pass, 100 % declarative. Everything below worked around
cleanly; each item is where the workaround cost a case or a sentence.

## O1 — There is no way to say "must NOT contain"

The open-redirect guard: `GET /hub/kjasset/login?next=https://evil.example/`
with a session → 307, and the `Location` must stay inside the hub. The case
can only state the positive half:

```json
"headers": { "location": { "$contains": "/hub/kjasset" } }
```

A regression that produced `https://evil.example/?back=/hub/kjasset` would
pass it. The intent says "must not leave the hub"; the oracle cannot.

**Proposal.** A negation matcher, in the same sole-key shape as the others:

```json
"location": { "$notContains": "evil.example" }
```

or a general `{ "$not": { "$contains": "evil.example" } }` so `$not` composes
with future matchers. `validate` can keep its "stands alone" rule.

## O2 — One `$contains` per value means one case per substring

A board page should show the seeded announcement title *and* the write
button (staff may post announcements). `$contains` takes a single string, so
that promise is two cases against the same request
(`CASE-hub-board-lists-entries`, `CASE-hub-board-write-button`), and the
report counts them as two.

**Proposal.** Accept a list: `{ "$contains": ["보안 교육 이수 요청",
"/admin/collections/announcements/create"] }` meaning all-of, with each
missing substring reported separately in the evidence. Single string stays
valid.

## O3 — A new case needs a fake hash before `stamp` will give it a real one

`from.hash` is required by the schema, so a hand-written case starts life
with a placeholder (`"000000000000"`) that `peira stamp` then replaces. Every
new case in this round went through that step; the placeholder is noise in
the diff and in the case history.

**Proposal, lightest first.** (a) `stamp` fills a *missing* `from.hash` the
same way it corrects a stale one, and `validate` warns instead of erroring
on a case that has `from.intent` but no hash yet. (b) `peira new <intent-id>
[--id CASE-…]` writes a stamped skeleton with `test.request` and
`test.expect` stubs.

## O4 — `service` can start the app but cannot prepare its data

Locally the suite is `./demo.sh reset && npm run test:api`, because the same
seed against a persisted database collides on unique fields (0.4.0's seed
guidance covers the *why*). In CI the workflow runs the reset as a separate
step. So `npm run test:api` alone is not self-contained on a laptop.

**Proposal.** `service.before` (or `service.prepare`): a command run once
before the service starts, in `service.cwd`, with the run's seed exported as
`PEIRA_SEED`. Then the bed carries the whole recipe:

```json
"service": { "before": "./demo.sh reset", "command": "npx next dev -p 3100", "cwd": "..", "readyMs": 90000 }
```

## O5 — Repeated response headers: works, undocumented

`CASE-hub-logout` asserts `"set-cookie": { "$contains": "payload-token=;" }`
and passes with one cookie. What the runner does with several `Set-Cookie`
headers (join with `, `? first only? array?) is not written down, and
`Set-Cookie` is the one header where the join is ambiguous because cookie
attributes themselves contain commas (`Expires=Thu, 01 Jan 1970`).

**Proposal.** One sentence in the docs, and if the answer is "joined", a
note that `$contains` on the joined string is the intended way to assert on
any one cookie.

## Also noticed, no action needed

- Non-JSON bodies arrive as text and `$contains` matches on them; that is
  what made the HTML cases possible without a new body type. Worth a line
  in the README, because we only found it by reading `dist/http.js`.
- `followRedirects: false` plus `location` `$contains` is exactly the shape
  redirect-heavy pages need; the 0.4.0 addition did its job.
- Cookie-sending principals (`send.cookie`) and header-sending ones can
  coexist for the same account, which is how the hub (cookie) and the REST
  API (JWT header) share one login body. Nice property; keep it.
