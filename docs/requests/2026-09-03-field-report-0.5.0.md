# Peira 0.5.0 — three things left, and why each is worth doing

**For:** TimothyHan/peira · **From:** the consumer behind RFC-0003 · 0.5.0 upgraded
in place: 75 cases passed unchanged, then 78 after applying `$notContains`,
the `$contains` list and the shell-chained `service.command`. Four of the six
0.4.0 observations landed or were answered by documentation. These are the
three that remain, ordered by how little they cost against how much they
return. Each comes with the case it would let this suite write today.

## P1 — `stats` should report the positive/negative balance per intent

**The gap.** Peira knows, for every case, its intent and the status it expects.
Nothing reports how many cases per intent expect a refusal. Finding out that
this suite had ten negative-only intents and twenty positive-only ones took a
twelve-line script over `cases/*.json`. That is exactly the kind of fact a
reviewer asks about ("are we testing the failure paths?") and exactly the kind
`stats` exists to answer.

**Why it belongs in the tool.** Refusals are where multi-tenant and auth bugs
live — both real holes this suite found were denials that did not happen. A
suite can drift positive without anyone noticing, one happy-path case at a
time. A number on every run is the cheapest guard.

**Proposal.** Two columns in `stats`, per intent and in total:

```
intent                    cases  positive  negative  refusal-in-2xx
tenant-crud-matrix           14         4        10               0
hub-forbidden                 1         0         0               1
auth-bad-token                1         0         0               1
…
total                        78        35        37               6
```

- *positive*: expected status 2xx/3xx with no refusal oracle.
- *negative*: expected status 4xx/5xx.
- *refusal-in-2xx*: 2xx/3xx whose oracle is a denial — `$absent`, `$notContains`,
  a literal `null` on a principal key (`user: null`), or a `bodySchema` with
  `additionalProperties: false`. All of these are detectable statically.

Optional, later: a bed-level `"minNegativeShare": 0.3` that `validate` warns
on, so a team can pin the balance they want. No vocabulary change; `stats`
only.

## P2 — One line in the text-body docs about server-rendered React

**What happened.** Applying the new `$contains` list to a hub page, I asserted
the visible count `총 2건`. It failed: React streams adjacent text expressions
with comment separators, so the HTML reads `총 <!-- -->2<!-- -->건`. The
visible text is not a substring of the response. `$contains` on a text body is
the right oracle and did the right thing; the author needs to know the trap.

**Why it matters for Peira specifically.** Text-body matching is the feature
that made HTML pages testable here (0.4.0 field report). Every Next, Remix or
React-SSR user will meet this on their first count or interpolated label, and
they will conclude the matcher is broken rather than the HTML being what it is.

**Proposal.** In the Responses section, after "any other body arrives as a
string":

> Server-rendered React (Next.js and others) separates adjacent text
> expressions with `<!-- -->`, so `총 {n}건` arrives as `총 <!-- -->2<!-- -->건`.
> Assert on text that comes from one expression, or on a stable attribute
> value, not on visible text that spans an interpolation.

Optional and small: `validate` could warn when a `$contains` substring on a
route that is not `/api/` contains a digit adjacent to non-ASCII letters, the
signature of this trap — but the sentence alone prevents most of it.

## P3 — A multipart request body, in the smallest declarative shape

**The gap.** Uploads are the one class of promise this API makes that Peira
cannot state. Five cases exist as Vitest tests today only because there is no
way to send a file:

| Promise | Current witness | Would become |
| --- | --- | --- |
| A file that would exceed the tenant's storage plan is refused with 413 naming used/limit/needed | `tests/int/storageQuota.int.spec.ts` | `POST /api/documents` as the tenant's editor with a 6 KB file into a 5 KB custom-limit tenant → 413, `errors[0].message` `$contains "quota"` |
| Each upload collection refuses the wrong MIME type and stores nothing | `tests/int/uploads.int.spec.ts` (×4) | `POST /api/signatures` with a JPEG → 400; then `GET /api/signatures?where[filename][equals]=…` → `totalDocs: 0` |
| A contact submission carries a sample image as a private submission file | `tests/int/formRoute.int.spec.ts` | `POST /v1/pixel-tattoo/forms/contact` multipart with `_json` + file → 201; the file URL → 403 anonymously |

These are acceptance promises with a stable HTTP contract. They belong next to
the other 78, stamped to their intent sentences, and today they cannot be.

**The design concern, and a shape that respects it.** A file body threatens the
declarative model in two ways: cases could grow binary blobs, and "multipart"
could sprawl into a second request language. Both are avoidable with one rule
and one key:

```json
"request": {
  "method": "post",
  "route": "/api/signatures",
  "auth": "$users.pixelEditor",
  "multipart": {
    "fields": { "tenant": "{{tenantId}}", "_json": { "firstName": "P" } },
    "files": [
      { "field": "file", "path": "fixtures/8x8.jpg", "mimetype": "image/jpeg" }
    ]
  }
}
```

- `multipart` is mutually exclusive with `body`; `validate` refuses both.
- `fields` are strings or JSON objects (an object is serialised, which is how
  this API's `_json` part works and how most frameworks accept nested form
  data). Interpolation applies as everywhere else.
- `files[].path` is relative to the cases directory; `validate` fails if the
  file is missing. Fixtures are ordinary files in the repo — a 100-byte PNG
  or a 20-byte text file — never inline bytes in the case. `validate` could
  cap fixture size (say 256 KB) to keep the intent of "small, reviewable".
- `mimetype` is explicit so a case can send a file under the wrong type,
  which is what the MIME-refusal promises need.
- Evidence records the request as `multipart: <n fields, m files, k bytes>`,
  never the bytes.

That is one new request key, one validation rule, and no new matcher. It
mirrors how `body` already works (declared in JSON, redacted in evidence) and
keeps the case as the readable promise it is now.

**What it unlocks beyond this suite.** Any API with an upload endpoint — which
is most CMSes, most form backends, every avatar or attachment feature — has
its refusal paths (type, size, quota) in exactly the place Peira is best at:
declarative denials stamped to a sentence. Without multipart those APIs keep
a code suite beside Peira for the uploads alone, and once a code suite exists
the pressure to put everything there is real. Multipart is the feature that
keeps the boundary where 0.5.0 drew it.

## Order and size

| | Change | Size | Unlocks here |
| --- | --- | --- | --- |
| P2 | one paragraph of docs | trivial | prevents the first text-body surprise for every React user |
| P1 | two `stats` columns, optional bed threshold | small | a per-run answer to "do we test refusals?" |
| P3 | `request.multipart` + validation + evidence redaction | medium | 5 upload promises as cases; keeps upload-heavy APIs inside Peira |

Everything from 0.4.0 that could be a feature became one in 0.5.0, and what
could be a sentence became a sentence. These three follow the same split: two
small, one deliberate.
