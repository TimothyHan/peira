# Getting started with Peira

The journey from zero to CI, for a team with a RESTful API. Command reference: `peira help`.

## 0. Install (~2 minutes)

```bash
npm install -g peira        # Node ≥ 18; one first-party dependency — no third-party code
```

`peira run`, `validate`, `stats`, `render`, `evidence` need nothing else — ever. Only the two
authoring commands (`compile`, `adopt`) and the offline `triage` use a model, and they shell
out to your own logged-in Claude Code CLI session: no API key to provision, nothing in CI.

Then scaffold the project — deterministic, zero LLM, never overwrites:

```bash
peira init          # bed.json, intent/example.md, AGENTS.md (+ CLAUDE.md import), cases/
peira init --ci     # …plus a zero-LLM GitHub Actions workflow
```

`AGENTS.md` carries the drop-in agent instructions (§6) in the cross-tool convention that
Claude, Cursor, Copilot-style agents, and others read; `CLAUDE.md` is a one-line `@AGENTS.md`
import so Claude Code shares the same source of truth. Steps 1–2 below then reduce to "edit
`bed.json`, replace the example intent" — or just tell your agent what the service promises.

## 1. Describe your service — `bed.json`

The bed config is the **only** place Peira learns anything about your service:

```json
{
  "baseUrl": "http://localhost:8080",
  "users": { "alice": { "username": "alice", "password": "test-pw" } },
  "reset": { "method": "post", "url": "/test/reset" },
  "drain": { "route": "/orders/status", "idParam": "id", "statusPath": "body.state", "terminal": ["SHIPPED", "CANCELLED"] }
}
```

Everything except `baseUrl` is optional:

- **`users`** — named principals; cases refer to them as `$users.alice` and never contain
  credentials. A principal is Basic (`{"username", "password"}`), a **login** that returns a
  token, or a **static** API key — the case says `$users.staff` either way:

  ```json
  "staff": { "login": { "route": "/api/login", "body": { "email": "staff@example.com", "password": "…" },
                        "token": "body.token", "send": { "header": "Authorization", "format": "Bearer {{token}}" } } },
  "svc":   { "token": "sk_…", "send": { "header": "X-API-Key", "format": "{{token}}" } }
  ```

  A login principal logs in once per run and every case under it carries the token; a login
  that is refused makes those cases `error`, never `fail`. `send` can also be
  `{"cookie": "session"}`. Tokens and passwords are scrubbed from the evidence log by value.
- **`reset`** — one HTTP call made before each run, pointed at your service's own
  wipe-test-state endpoint. Solves run-to-run contamination (the "restart the app between
  runs" problem) and is what makes same-seed determinism a testable claim.
- **`drain`** — for services with async jobs: how to ask *your* service whether a job is
  settled (which endpoint, which id parameter, where the state lives, which states are
  terminal). Cases declare only *that* they must clean up (`"teardown": {"drain": true}`);
  the bed knows *how*. This replaces sleep-and-pray teardowns: the runner polls every job a
  case created — under the credentials that created it — until it settles, so one case's
  leftovers can never poison the next case's timing assertions.
- **`timeouts`** — the service's latency envelope, when the defaults don't fit (a slow
  staging environment isn't broken, it's slow): `{"requestMs": 15000, "pollUntilMs": 60000,
  "drainMs": 60000, "stepMs": 20000}`, each optional. These are ceilings only — hitting one
  is still an `error` verdict, never a `fail`.
- **`service`** — how `peira run` starts the app under test, so "start your server first"
  stops being a manual step: `{"command": "npm run dev", "cwd": "../my-service",
  "readyMs": 30000, "reuse": true}`. With `reuse` (the default) an already-answering
  `baseUrl` is used as-is and never killed — the dev-loop case; otherwise the command runs
  in its own process group, Peira waits until `baseUrl` answers (any HTTP response counts —
  a 404 proves something is listening), and kills the whole group when the run ends. In
  watch mode it lives for the whole session. Set `"reuse": false` in `bed.ci.json` so CI
  fails loudly on a port squatter instead of testing a stale instance. Only `run` manages
  processes — the read-only commands never spawn anything.

Keep one bed file per environment (`bed.json`, `bed.ci.json`): same cases, different target —
a slow staging bed can declare generous `timeouts` while CI keeps the tight defaults.

## 2. Write intent — `intent/*.md`

Intent is the human-owned source of truth: plain markdown, one `##` section per acceptance
criterion or invariant.

```markdown
## Creating an order
<!-- peira: id=order-create kind=ac -->
POST /orders with a valid payment method returns 201 with the new order's id.

## Order isolation
<!-- peira: id=order-isolation kind=invariant -->
For all orders o, for all users u ≠ owner(o): GET /orders/{o} as u → 403.
```

- Tags are optional (untagged headings derive ids from their text) but **recommended**: the
  id is a permanent lineage anchor, and a tagged section can be reworded freely without
  orphaning its cases. `kind=invariant` sections compile to templates that mint fresh seeded
  probes every run.
- **Organize files by capability, not by endpoint** (`orders.md`, `auth.md`): real promises
  cross endpoints (isolation spans create *and* read). Files are just namespaces — the
  **section** is the unit of everything (lineage, stale detection, targeted recompile), so
  keep one independently-changing promise per section. `peira validate --intent` lints for
  oversized sections and fragile derived ids.
- **Already have a test plan?** Two paths. A well-structured document ingests verbatim —
  zero edits (Peira's own reference plan did). A messy one (Confluence export,
  ticket dump) goes through the one-time adoption assist:

```bash
peira adopt legacy-test-plan.md --out intent/orders.md
```

  It restructures — never rewrites — into one-promise-per-section with stable tags, refuses
  untagged output, and prints a content-preservation report naming any source line that
  didn't survive. **You review the result and commit it: from then on it is your document.**
  Nothing ever normalizes silently at compile time.

## 3. Compile

```bash
peira compile intent --out cases --bed bed.json
peira compile intent --dry-run    # how well does my intent compile? report only, nothing written
```

`--dry-run` is the feedback loop on your *document*. It reports how many sections compiled,
and — the useful part — **why** any section was skipped ("states no verifiable behavior; names
no route or status code") or why a candidate was refused by the gate. A skip is a note about
your intent, not a failure of the tool: it usually means that section is prose, or a quality
attribute no functional API case can state. Both still cost a model call per section.

Runs on your Claude session. Every candidate case passes the same schema gate as a
hand-written one; lineage is stamped mechanically; `cases/compile-manifest.json` accounts for
every section (compiled / skipped-with-reason / refused). **Review the generated cases as a
diff** — that review is the human checkpoint the trust model is built on.

## 4. Run locally

```bash
peira run cases --bed bed.json --seed 42 --evidence run.jsonl
```

Verdicts are `pass | fail | error` — assertion failures and infrastructure failures are never
conflated. The seed is always printed: any failure reproduces exactly with the same seed
against the same service state. First runs usually surface both real bugs *and* stale intent —
that's the point.

The tight dev loop and bigger suites:

```bash
peira run cases --bed bed.json --seed 42 --only CASE-order-cancel-shipped-001   # re-run one failing case
peira run cases --bed bed.json --grep order      # every case whose id contains "order"
peira run cases --bed bed.json --parallel 8      # worker pool; verdicts and evidence order identical to serial
peira run cases --bed bed.json --intent intent --watch   # re-run on change, mapped by lineage
```

Watch mode is verified on macOS and Linux; its file-event delivery on Windows is unverified
(as is `bed.service`'s process-tree handling — everything else is tested on Linux and Windows
across Node 18, 20, 22, and 24). Watch mode maps changes by lineage, not an
import graph: editing a case re-runs exactly that
case; editing the bed or a registry re-runs everything; editing intent re-runs *nothing* —
verdicts can't change, so it re-checks staleness and names the affected cases instead, and
recompiling stays your call (never an LLM on a save hook). The seed is pinned per session so
re-runs are comparable.

The loop:

```bash
peira triage --evidence run.jsonl --intent intent    # proposes bug | drift | flake; applies nothing
# you adjudicate: fix the service, or edit the intent…
peira validate cases --bed bed.json --intent intent  # stale flags name the affected cases
peira compile intent --out cases --bed bed.json --section <changed-section>
```

Share readable documentation any time:

```bash
peira render cases --intent intent --out TESTCASES.md            # Given/When/Then test cases
peira render cases --intent intent --evidence run.jsonl          # …as a run report with verdicts
```

(One-way output — regenerate it, never edit it.)

## 5. CI

Commit `intent/`, `cases/`, and the bed configs. **CI runs zero LLM** — no key, no session:

```yaml
# .github/workflows/api-tests.yml
- run: npm ci
- run: docker compose up -d orders-service
- run: npx peira validate cases --bed bed.ci.json --intent intent
- run: npx peira run cases --bed bed.ci.json --seed ${{ github.run_id }} --evidence run.jsonl --junit junit.xml
- if: always()
  uses: actions/upload-artifact@v4
  with: { name: evidence, path: run.jsonl }
```

`--junit` writes standard JUnit XML (pass/fail/error map to testcase/failure/error), so any CI
test-report UI renders Peira runs without wrapper scripts. At scale, fan out across machines
with `--shard 1/3`, `--shard 2/3`, `--shard 3/3` — shards are disjoint deterministic slices
whose union is exactly the full run. If the service has an OpenAPI
document, `peira stats cases --openapi openapi.json` reports which endpoints have no case —
the spec stays optional; the report only exists when you offer one.

The exit code gates the merge. When CI goes red, pull the evidence artifact and triage it
locally — adjudication stays a human act, never a bot in the pipeline. Then record the
adjudicated run into Peira's evidence ledger, so your intent sections earn evidence-gated
trust across runs:

```bash
peira evidence --evidence run.jsonl --triage run-triage.json --intent intent
```

Passing sections log `applied` (a triaged bug also logs `applied` — the section did its job
catching the violation); adjudicated drift logs `contradicted` with the verbatim note; flake
and untriaged failures log nothing. One event per section per run, so the ledger counts runs,
not case volume. A portable JSONL export is written alongside; `peira trust` shows the
standings per section. The ledger lives in `.peira/` plus an `akela.json` config at the
project root — commit both, never edit them; trust is earned by runs, not by hand. Note:
intent sections live at `##` heading level — that is the sectioning the ledger indexes.

## 6. Use it through your agent (the primary way)

Peira is agent-native by design: the authoring surfaces already run on your own Claude
session, and the zero-LLM runner is exactly what makes agent-driven testing trustworthy — an
agent cannot wiggle a red run green; it can only fix the service or propose an intent change
you approve. In practice you talk to your agent in intent-language ("add coverage: cancelling
a shipped order must be refused") and it edits the plan, compiles, runs, renders the report,
and drafts triage for *your* adjudication.

`peira init` scaffolds this as `AGENTS.md` (with a `CLAUDE.md` import for Claude Code) —
or drop it into your agent's instruction file yourself:

```markdown
# API testing with Peira

Peira compiles a markdown test plan (intent/*.md) into JSON cases and runs them with
no model in the loop. Everything the tool can say is in one place — read it before you
write a case, and again after the tool is upgraded:

    peira reference

## The loop

- Intent is the source of truth. To change a test, edit its intent section, then
  recompile exactly that section:
    peira compile intent --out cases --bed bed.json --section <id>
- A case written by hand is fine; bind it to its section without a model:
    peira stamp cases --intent intent        (--check in CI: exit 1 if anything is unstamped or stale)
- Run and keep the evidence (the printed seed replays any failure exactly):
    peira run cases --bed bed.json --evidence run.jsonl
- On failures, triage and PRESENT the proposals — adjudication belongs to the
  human, never to you:
    peira triage --evidence run.jsonl --intent intent
- When the human wants to see results:
    peira render cases --intent intent --evidence run.jsonl --format html --out report.html
- After adjudication, record the run so intent sections earn trust:
    peira evidence --evidence run.jsonl --triage run-triage.json --intent intent

## Rules the gate enforces (validate says so, with the fix in the message)

- Never edit a compiled case to make a run green; fix the service or propose an intent change.
- from.intent is yours; from.hash never is — compile stamps it, `peira stamp` fills it.
- Inside a string use {{alias}}; a bare $alias is only the whole value.
- No wall-clock sleeps. Eventual consistency is pollUntil; cleanup is teardown {"drain": true}.
- Matchers stand alone: $any, $contains (string or all-of list), $notContains, $absent, null.
  Negative claims are where the bugs are — assert what a user must NOT see or hold.
- Cases never contain credentials: auth is "$users.<alias>"; the bed defines the alias.
- A red run is pass | fail | error and the kinds are never conflated: error means the
  environment failed before the claim was judged — say so, do not report it as a bug.
```

The guardrails hold regardless of who types: the schema gate refuses malformed output rather
than patching it, triage only ever proposes, and the evidence ledger records what was decided
with the reason quoted verbatim.

## Understanding seeds (test data by formula)

The seed is the replay number for a run: one integer that every "random" value is *derived*
from, rather than data being stored or truly random.

- **What it controls:** `$unique.*` discriminators in cases, and every hole draw in minted
  invariant cases (which principals, which generated expression). All are computed as
  `hash(seed, case id, key)` — pure functions, no stored data, no real randomness.
- **What it never changes:** the case set and its claims. A seed varies the incidental
  values, never what is asserted.
- **Reproduction:** omit `--seed` and Peira picks one, but always prints it and records it in
  the evidence log and reports. Any failure replays exactly: `peira run … --seed <that seed>`.
  A minted case even carries its full coordinates (`template`, `seed`, `instance`) in its
  lineage — three numbers regenerate it from nothing.
- **Strong oracles on fresh data:** the expression generator produces data *paired with its
  known answer* (`47 * 12` arrives with `"564"`), so minted cases assert exact results for
  values that didn't exist until the run started — no weak "some string" oracles.
- **A verdict that flips across seeds is a signal, not noise:** for a correct, deterministic
  service, verdicts are identical across seeds even though payloads differ. A seed-dependent
  failure means either a value-dependent bug (exactly what invariant sampling exists to
  catch) or nondeterminism — flake territory, where triage prescribes a re-run.
- **CI strategy:** use a fresh seed per pipeline run (`--seed ${{ github.run_id }}`) so
  invariants probe new corners of their space every run, while every red run stays one
  command from exact reproduction.
- **The honest caveat (RFC invariant 8):** the seed pins Peira's choices, not the world's.
  Same-seed determinism also needs same service state — that is what the bed's `reset` hook
  is for.
- **Same seed, same unreset service: the run collides with itself.** A case that *creates*
  state (`"title": "peira {{unique.title}}"`) derives the same title from the same seed, so its
  second run against the same database finds the slug already taken and reports a `fail` that
  reads like a regression. Cases that create state need one of: a `reset`, a fresh seed per
  run, or a service that tolerates duplicates. Many services have no wipe endpoint and a shared
  staging environment never will — there, vary the seed locally too (`--seed $(date +%s)`), the
  same advice CI already follows with the run id. The printed seed still replays any failure
  exactly; what it cannot do is un-create yesterday's data.

One line to remember: **cases say what must be true, the seed says which concrete data to try
this time, and the same seed always tries the same data.**

## Steady state

Requirements change → edit intent → the PR shows two readable diffs (the intent sentence and
the regenerated cases) → merge. Invariants keep minting fresh probes every run, so a known bug
can never quietly rotate out of coverage. `peira stats` shows DSL coverage and whether escape
hatches are accumulating into a missing primitive.

## Honest v0.1 limits

Basic auth only; one service under test per run; sequential execution; `compile`/`triage`/
`adopt` require the Claude Code CLI. All are extension points, not walls — and the DSL grows
only from demonstrated demand ([docs/DESIGN.md](DESIGN.md) §4.6 explains why).
