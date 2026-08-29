// Shared CLI plumbing: flag parsing, bed loading, registry resolution, error reporting.
// Each command module gets one `ctx` and returns an exit code.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSteps, loadTemplates } from '../validate.js';

export const USAGE = `usage: peira <command>
  validate [casesDir] [--bed <path>] [--intent <dir>] [--steps <dir>] [--templates <dir>]
  run      [casesDir] --bed <path> [--base-url <url>] [--seed <n>] [--evidence <path>] [--steps <dir>] [--templates <dir>]
  compile  [intentDir] --out <dir> [--bed <path>] [--section <id>]... [--steps <dir>] [--templates <dir>]
  stats    [casesDir] [--steps <dir>]
  triage   --evidence <run.jsonl> --intent <dir> [--out <path>]
  evidence --evidence <run.jsonl> [--triage <proposals.json>] [--out <path>]
  render   [casesDir] [--intent <dir>] [--evidence <run.jsonl>] [--triage <proposals.json>] [--format md|html] [--out <path>]
  adopt    <messy.md> --out <intent/name.md>

flags:
  --bed <path>        bed config JSON: {baseUrl, users?, reset?, drain?} — the only place Peira learns about your service
  --base-url <url>    override the bed's baseUrl (e.g. point the same cases at CI vs local)
  --seed <n>          run seed; same seed + same service state → same verdicts (default: random, always printed)
  --evidence <path>   write the run's evidence JSONL (run) / read it (triage, evidence, render)
  --intent <dir>      intent directory — stale check + lint (validate), sections (compile, triage, render)
  --steps <dir>       steps registry (default: <casesDir>/steps, else ./steps)
  --templates <dir>   templates registry (default: <casesDir>/templates, else ./templates)
  --out <dir|file>    output target — compile: cases dir; triage/evidence/render/adopt: file
  --section <id>      compile only this intent section (repeatable; targeted recompile merges the manifest)
  --triage <path>     triage proposals JSON to fold into the Akela evidence export

docs: docs/GETTING-STARTED.md | design: docs/DESIGN.md`;

export function buildContext(argv) {
  const [, , command, ...rest] = argv;
  const { values: flags, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      bed: { type: 'string' },
      'base-url': { type: 'string' },
      seed: { type: 'string' },
      evidence: { type: 'string' },
      intent: { type: 'string' },
      out: { type: 'string' },
      section: { type: 'string', multiple: true },
      triage: { type: 'string' },
      steps: { type: 'string' },
      templates: { type: 'string' },
      format: { type: 'string' },
    },
  });

  const casesDir = positionals[0] ?? 'cases';
  const bed = flags.bed ? JSON.parse(readFileSync(flags.bed, 'utf8')) : null;

  const reportRegistry = (results) => {
    let errorCount = 0;
    for (const r of results) {
      for (const msg of r.errors) {
        console.error(`ERROR ${r.file}: ${msg}`);
        errorCount += 1;
      }
    }
    return errorCount;
  };

  return {
    command,
    flags,
    positionals,
    casesDir,
    bed,

    // steps registry: explicit flag, else <casesDir>/steps, else ./steps, else empty
    stepsRegistry() {
      const dir = flags.steps ?? [join(casesDir, 'steps'), 'steps'].find((d) => existsSync(d)) ?? null;
      const { steps, results } = loadSteps(dir);
      return { steps, errorCount: reportRegistry(results) };
    },

    templatesRegistry(steps) {
      const dir = flags.templates ?? [join(casesDir, 'templates'), 'templates'].find((d) => existsSync(d)) ?? null;
      const { templates, results } = loadTemplates(dir, { bedUsers: bed?.users, steps });
      return { templates, errorCount: reportRegistry(results) };
    },

    reportValidation(results, parseErrors) {
      let errorCount = parseErrors.length;
      for (const msg of parseErrors) console.error(`ERROR ${msg}`);
      for (const r of results) {
        for (const msg of r.errors) {
          console.error(`ERROR ${r.file}: ${msg}`);
          errorCount += 1;
        }
        for (const msg of r.warnings) console.error(`warn  ${r.file}: ${msg}`);
      }
      return errorCount;
    },
  };
}
