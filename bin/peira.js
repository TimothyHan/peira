#!/usr/bin/env node
// peira validate [dir] [--bed <path>]
// peira run      [dir] --bed <path> [--base-url <url>] [--seed <n>] [--evidence <path>]

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadCases } from '../src/load.js';
import { validateCaseSet } from '../src/validate.js';
import { runCases } from '../src/runner.js';
import { httpRequest } from '../src/http.js';

function reportValidation(results, parseErrors) {
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
}

const [, , command, ...rest] = process.argv;
const { values: flags, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    bed: { type: 'string' },
    'base-url': { type: 'string' },
    seed: { type: 'string' },
    evidence: { type: 'string' },
  },
});

const casesDir = positionals[0] ?? 'cases';
const bed = flags.bed ? JSON.parse(readFileSync(flags.bed, 'utf8')) : null;

if (command === 'validate') {
  const { loaded, parseErrors } = loadCases(casesDir);
  const { results } = validateCaseSet(loaded, { bedUsers: bed?.users });
  const errorCount = reportValidation(results, parseErrors);
  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s) across ${loaded.length + parseErrors.length} file(s) — refused`);
    process.exit(1);
  }
  process.exit(0);
} else if (command === 'run') {
  if (!bed && !flags['base-url']) {
    console.error('peira run needs --bed <path> (or at minimum --base-url <url>)');
    process.exit(2);
  }
  const { loaded, parseErrors } = loadCases(casesDir);
  const { results, ok } = validateCaseSet(loaded, { bedUsers: bed?.users });
  const errorCount = reportValidation(results, parseErrors);
  if (errorCount > 0 || !ok) {
    console.error('\nvalidation failed — nothing was run');
    process.exit(1);
  }

  const baseUrl = flags['base-url'] ?? bed.baseUrl;
  if (bed?.reset?.url) {
    await httpRequest({ baseUrl, method: bed.reset.method ?? 'post', route: bed.reset.url });
  }

  const seed = flags.seed !== undefined ? Number(flags.seed) : Math.floor(Math.random() * 2 ** 32);
  const { verdicts, counts } = await runCases(loaded, {
    bed: bed ?? { users: {} },
    baseUrl,
    seed,
    evidencePath: flags.evidence ?? null,
  });

  for (const v of verdicts) {
    const line = `${v.verdict.toUpperCase().padEnd(5)} ${v.id}${v.reason ? ` — ${v.reason}` : ''}`;
    (v.verdict === 'pass' ? console.log : console.error)(line);
    for (const d of v.diffs ?? []) {
      console.error(`        ${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)} (${d.reason})`);
    }
  }
  console.log(`\nseed ${seed} | ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error`);
  process.exit(counts.fail + counts.error > 0 ? 1 : 0);
} else {
  console.error('usage: peira <validate|run> [casesDir] [--bed <path>] [--base-url <url>] [--seed <n>] [--evidence <path>]');
  process.exit(2);
}
