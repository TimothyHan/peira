// `peira init [dir] [--ci]` — deterministic scaffolding, zero LLM, zero prompts (agents run
// this too; flags over interactivity). Never overwrites: every file reports created | kept.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { green, dim } from './color.js';
import type { CliContext } from './context.js';

const BED_JSON = `{
  "$comment": "the only place Peira learns about your service. Optional keys: users (named principals — basic auth, a login request that returns a token, or a static API key), reset (one wipe-state call before each run), drain (how to ask your service whether an async job settled), timeouts (a slow environment's latency envelope), service (how 'peira run' starts the app under test: {command, cwd?, readyMs?, reuse?}) — see 'peira help' and docs/GETTING-STARTED.md",
  "baseUrl": "http://localhost:3000"
}
`;

const INTENT_EXAMPLE = `# Example service promises

Replace these with your service's real promises — one \`##\` section per acceptance
criterion or invariant. The section is the unit of everything: lineage, stale detection,
targeted recompile. Your agent adds the tags; untagged headings work too.

## Creating an order
<!-- peira: id=order-create kind=ac -->

POST /orders with a valid payload returns 201, and the response carries the new order's id.

## Order isolation
<!-- peira: id=order-isolation kind=invariant -->

For all orders o, for all users u other than the owner of o: GET /orders/{o} as u is refused
with 403.
`;

// AGENTS.md is the cross-tool convention (Claude Code via the CLAUDE.md import below, Cursor,
// Copilot's coding agent, and others read it) — the workflow is agent-native, not Claude-only.
export const AGENT_INSTRUCTIONS = `# API testing with Peira

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
- from.intent is yours; from.hash never is — compile stamps it, \`peira stamp\` fills it.
- Inside a string use {{alias}}; a bare $alias is only the whole value.
- No wall-clock sleeps. Eventual consistency is pollUntil; cleanup is teardown {"drain": true}.
- Matchers stand alone: $any, $contains (string or all-of list), $notContains, $absent, null.
  Negative claims are where the bugs are — assert what a user must NOT see or hold.
- Cases never contain credentials: auth is "$users.<alias>"; the bed defines the alias.
- A red run is pass | fail | error and the kinds are never conflated: error means the
  environment failed before the claim was judged — say so, do not report it as a bug.
`;

const CI_WORKFLOW = `# Peira in CI — zero LLM: no API key, no session; the exit code gates the merge.
name: api-tests
on: [push, pull_request]
jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      # start your service here, e.g.: docker compose up -d my-service
      - run: npx peira validate cases --bed bed.json --intent intent
      - run: npx peira run cases --bed bed.json --seed \${{ github.run_id }} --evidence run.jsonl --junit junit.xml
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: evidence, path: run.jsonl }
`;

export async function main(ctx: CliContext): Promise<number> {
  const target = ctx.positionals[0] ?? '.';
  mkdirSync(join(target, 'intent'), { recursive: true });
  mkdirSync(join(target, 'cases'), { recursive: true }); // compile's --out target; empty until then

  const files: Array<[string, string]> = [
    [join(target, 'bed.json'), BED_JSON],
    [join(target, 'intent', 'example.md'), INTENT_EXAMPLE],
    [join(target, 'AGENTS.md'), AGENT_INSTRUCTIONS],
    // Claude Code reads CLAUDE.md; the @-import keeps one source of truth for every agent
    [join(target, 'CLAUDE.md'), '@AGENTS.md\n'],
  ];
  if (ctx.flags.ci) files.push([join(target, '.github', 'workflows', 'api-tests.yml'), CI_WORKFLOW]);

  const kept = new Set<string>();
  for (const [path, content] of files) {
    if (existsSync(path)) {
      console.log(`${dim('kept   ')} ${path} ${dim('(already exists — not touched)')}`);
      kept.add(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`${green('created')} ${path}`);
  }

  if (kept.has(join(target, 'AGENTS.md'))) {
    console.log(`\n${dim('your AGENTS.md already exists — append this block to make the workflow agent-native:')}\n`);
    console.log(AGENT_INSTRUCTIONS.split('\n').slice(1).join('\n')); // body without the # heading
  } else if (kept.has(join(target, 'CLAUDE.md'))) {
    console.log(`\n${dim('your CLAUDE.md already exists — add this line to it so Claude Code reads the scaffolded instructions:')}\n\n@AGENTS.md`);
  }

  console.log(`\nnext steps:
  1. edit ${join(target, 'bed.json')} — point baseUrl at your service
  2. replace ${join(target, 'intent', 'example.md')} with your service's real promises
     ${dim('(or just tell your agent — Claude, Cursor, Copilot, … — what the service promises; AGENTS.md briefs it)')}
  3. peira compile intent --out cases --bed bed.json   ${dim('(authoring step — uses a logged-in Claude Code CLI)')}
  4. peira run cases --bed bed.json                     ${dim('(zero LLM — deterministic verdicts)')}`);
  return 0;
}
