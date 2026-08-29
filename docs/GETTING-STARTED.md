# Getting started with Peira

The journey from zero to CI, for a team with a RESTful API. Command reference: `peira help`.

## 0. Install (~2 minutes)

```bash
npm install -g peira        # Node ≥ 18, zero runtime dependencies
```

`peira run`, `validate`, `stats`, `render`, `evidence` need nothing else — ever. Only the two
authoring commands (`compile`, `adopt`) and the offline `triage` use a model, and they shell
out to your own logged-in Claude Code CLI session: no API key to provision, nothing in CI.

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

- **`users`** — named principals for basic auth; cases refer to them as `$users.alice` and
  never contain credentials.
- **`reset`** — one HTTP call made before each run, pointed at your service's own
  wipe-test-state endpoint. Solves run-to-run contamination (the "restart the app between
  runs" problem) and is what makes same-seed determinism a testable claim.
- **`drain`** — for services with async jobs: how to ask *your* service whether a job is
  settled (which endpoint, which id parameter, where the state lives, which states are
  terminal). Cases declare only *that* they must clean up (`"teardown": {"drain": true}`);
  the bed knows *how*. This replaces sleep-and-pray teardowns: the runner polls every job a
  case created — under the credentials that created it — until it settles, so one case's
  leftovers can never poison the next case's timing assertions.

Keep one bed file per environment (`bed.json`, `bed.ci.json`): same cases, different target.

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
  zero edits (Peira's own 4-year-old ancestor plan did). A messy one (Confluence export,
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
```

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
that's the point. The loop:

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
- run: npx peira run cases --bed bed.ci.json --seed ${{ github.run_id }} --evidence run.jsonl
- if: always()
  uses: actions/upload-artifact@v4
  with: { name: evidence, path: run.jsonl }
```

The exit code gates the merge. When CI goes red, pull the evidence artifact and triage it
locally — adjudication stays a human act, never a bot in the pipeline. Optionally export
adjudicated runs as flat evidence records:

```bash
peira evidence --evidence run.jsonl --triage run-triage.json     # applied/contradicted JSONL
```

## Steady state

Requirements change → edit intent → the PR shows two readable diffs (the intent sentence and
the regenerated cases) → merge. Invariants keep minting fresh probes every run, so a known bug
can never quietly rotate out of coverage. `peira stats` shows DSL coverage and whether escape
hatches are accumulating into a missing primitive.

## Honest v0.1 limits

Basic auth only; one service under test per run; sequential execution; `compile`/`triage`/
`adopt` require the Claude Code CLI. All are extension points, not walls — and the DSL grows
only from demonstrated demand ([docs/DESIGN.md](DESIGN.md) §4.6 explains why).
