// Shared CLI plumbing: flag parsing, bed loading, registry resolution, error reporting.
// Each command module gets one `ctx` and returns an exit code.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSteps, loadTemplates, type RegistryResult } from '../validate.js';
import { red, yellow } from './color.js';
import { validateBed } from '../validate-bed.js';
import type { BedConfig, StepDef, Template } from '../types.js';

export interface CliFlags {
  bed?: string;
  'base-url'?: string;
  seed?: string;
  evidence?: string;
  intent?: string;
  out?: string;
  section?: string[];
  triage?: string;
  steps?: string;
  templates?: string;
  format?: string;
  'no-ledger'?: boolean;
  only?: string[];
  grep?: string;
  junit?: string;
  parallel?: string;
  openapi?: string;
  watch?: boolean;
  shard?: string;
  ci?: boolean;
  'dry-run'?: boolean;
}

export interface CliContext {
  command: string | undefined;
  flags: CliFlags;
  positionals: string[];
  casesDir: string;
  bed: BedConfig | null;
  /** RFC 0002 §3.6 — the bed gate; every command that loads a bed reports these */
  bedErrors: string[];
  stepsRegistry(): { steps: Map<string, StepDef>; errorCount: number };
  templatesRegistry(steps: Map<string, StepDef>): { templates: Map<string, Template>; errorCount: number };
  reportValidation(results: Array<{ file: string; errors: string[]; warnings: string[] }>, parseErrors: string[]): number;
}

export const USAGE = `usage: peira <command>
  init     [dir] [--ci]
           scaffold a project: bed.json, intent/example.md, agent instructions (AGENTS.md — the
           cross-tool convention — plus a CLAUDE.md import for Claude Code);
           --ci adds a zero-LLM GitHub Actions workflow. Never overwrites existing files.
  validate [casesDir] [--bed <path>] [--intent <dir>] [--steps <dir>] [--templates <dir>]
  run      [casesDir] --bed <path> [--base-url <url>] [--seed <n>] [--evidence <path>] [--steps <dir>] [--templates <dir>]
           [--only <case-id>]... [--grep <substr>] [--parallel <n>] [--junit <path>] [--shard <i>/<n>] [--watch]
  compile  [intentDir] --out <dir> [--bed <path>] [--section <id>]... [--steps <dir>] [--templates <dir>] [--dry-run]
  stats    [casesDir] [--steps <dir>] [--openapi <spec.json>]
  triage   --evidence <run.jsonl> --intent <dir> [--out <path>]
  evidence --evidence <run.jsonl> [--triage <proposals.json>] --intent <dir> [--out <path>] [--no-ledger]
           records the run into the evidence ledger; also writes the portable JSONL export
  trust    shows the ledger standings — per intent section: applied, contradicted, runs
  render   [casesDir] [--intent <dir>] [--evidence <run.jsonl>] [--triage <proposals.json>] [--format md|html] [--out <path>]
  adopt    <messy.md> --out <intent/name.md>

flags:
  --bed <path>        bed config JSON: {baseUrl, users?, reset?, drain?, timeouts?, service?} — the only place Peira learns
                      about your service; timeouts declares its latency envelope: {requestMs?, pollUntilMs?, drainMs?, stepMs?};
                      service starts the app under test for 'run': {command, cwd?, readyMs?, reuse?} — an already-answering
                      baseUrl is reused (and never killed) unless reuse is false
  --base-url <url>    override the bed's baseUrl (e.g. point the same cases at CI vs local)
  --seed <n>          run seed; same seed + same service state → same verdicts (default: random, always printed)
  --evidence <path>   write the run's evidence JSONL (run) / read it (triage, evidence, render)
  --intent <dir>      intent directory — stale check + lint (validate), sections (compile, triage, render)
  --steps <dir>       steps registry (default: <casesDir>/steps, else ./steps)
  --templates <dir>   templates registry (default: <casesDir>/templates, else ./templates)
  --out <dir|file>    output target — compile: cases dir; triage/evidence/render/adopt: file
  --section <id>      compile only this intent section (repeatable; targeted recompile merges the manifest)
  --dry-run           compile and report, write nothing — how well does your intent compile, and why was a
                      section skipped or a candidate refused? (still spends a model call per section)
  --triage <path>     triage proposals JSON to fold into the ledger evidence export
  --no-ledger         write the JSONL export only; skip recording into the evidence ledger
  --only <case-id>    run only this case (repeatable; the whole set still validates first)
  --grep <substr>     run only cases whose id contains <substr> (combines with --only as a union)
  --parallel <n>      run up to n cases concurrently; verdicts and evidence order stay identical to a serial run
  --junit <path>      also write the run as JUnit XML (pass/fail/error map to testcase/failure/error)
  --shard <i>/<n>     run the i-th of n deterministic slices (CI fan-out; shards are disjoint, their union is the full run)
  --watch             re-run on change: case edits re-run just those cases; bed/steps/templates re-run all;
                      intent edits report stale cases (recompiling stays a human act). Seed is pinned per session.
  --openapi <path>    OpenAPI JSON document — stats adds an endpoint-coverage report (which endpoints have no case)

docs: docs/GETTING-STARTED.md | design: docs/DESIGN.md`;

export function buildContext(argv: string[]): CliContext {
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
      'no-ledger': { type: 'boolean' },
      only: { type: 'string', multiple: true },
      grep: { type: 'string' },
      junit: { type: 'string' },
      parallel: { type: 'string' },
      openapi: { type: 'string' },
      watch: { type: 'boolean' },
      shard: { type: 'string' },
      ci: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  });

  const casesDir = positionals[0] ?? 'cases';
  const bed: BedConfig | null = flags.bed ? JSON.parse(readFileSync(flags.bed, 'utf8')) : null;
  const bedErrors = bed ? validateBed(bed).map((m) => `${flags.bed}: ${m}`) : [];

  const reportRegistry = (results: RegistryResult[]): number => {
    let errorCount = 0;
    for (const r of results) {
      for (const msg of r.errors) {
        console.error(`${red('ERROR')} ${r.file}: ${msg}`);
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
    bedErrors,

    // steps registry: explicit flag, else <casesDir>/steps, else ./steps, else empty
    stepsRegistry() {
      const dir = flags.steps ?? [join(casesDir, 'steps'), 'steps'].find((d) => existsSync(d)) ?? null;
      const { steps, results } = loadSteps(dir);
      return { steps, errorCount: reportRegistry(results) };
    },

    templatesRegistry(steps: Map<string, StepDef>) {
      const dir = flags.templates ?? [join(casesDir, 'templates'), 'templates'].find((d) => existsSync(d)) ?? null;
      const { templates, results } = loadTemplates(dir, { bedUsers: bed?.users, steps });
      return { templates, errorCount: reportRegistry(results) };
    },

    reportValidation(results: Array<{ file: string; errors: string[]; warnings: string[] }>, parseErrors: string[]) {
      let errorCount = parseErrors.length;
      for (const msg of parseErrors) console.error(`${red('ERROR')} ${msg}`);
      for (const r of results) {
        for (const msg of r.errors) {
          console.error(`${red('ERROR')} ${r.file}: ${msg}`);
          errorCount += 1;
        }
        for (const msg of r.warnings) console.error(`${yellow('warn')}  ${r.file}: ${msg}`);
      }
      return errorCount;
    },
  };
}
