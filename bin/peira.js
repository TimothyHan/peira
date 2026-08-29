#!/usr/bin/env node
// peira validate [dir] [--bed <path>] [--intent <dir>] [--steps <dir>]
// peira run      [dir] --bed <path> [--base-url <url>] [--seed <n>] [--evidence <path>] [--steps <dir>]
// peira compile  <intentDir> --out <dir> [--bed <path>] [--section <id>]... [--steps <dir>]
// peira stats    [dir] [--steps <dir>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCases } from '../src/load.js';
import { validateCaseSet, loadSteps, loadTemplates } from '../src/validate.js';
import { computeStats, formatStats } from '../src/stats.js';
import { runCases } from '../src/runner.js';
import { httpRequest } from '../src/http.js';
import { loadIntentDir } from '../src/intent.js';
import { checkStale } from '../src/stale.js';
import { compileSections } from '../src/compile.js';
import { claudeCliTransport } from '../src/llm.js';
import { COMPILE_MODEL } from '../src/constants.js';

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
    intent: { type: 'string' },
    out: { type: 'string' },
    section: { type: 'string', multiple: true },
    steps: { type: 'string' },
    templates: { type: 'string' },
  },
});

const casesDir = positionals[0] ?? 'cases';
const bed = flags.bed ? JSON.parse(readFileSync(flags.bed, 'utf8')) : null;

// steps registry: explicit flag, else <casesDir>/steps, else ./steps, else empty
function stepsRegistry() {
  const dir = flags.steps ?? [join(casesDir, 'steps'), 'steps'].find((d) => existsSync(d)) ?? null;
  const { steps, results } = loadSteps(dir);
  return { steps, errorCount: reportRegistry(results) };
}

function templatesRegistry(steps) {
  const dir = flags.templates ?? [join(casesDir, 'templates'), 'templates'].find((d) => existsSync(d)) ?? null;
  const { templates, results } = loadTemplates(dir, { bedUsers: bed?.users, steps });
  return { templates, errorCount: reportRegistry(results) };
}

function reportRegistry(results) {
  let errorCount = 0;
  for (const r of results) {
    for (const msg of r.errors) {
      console.error(`ERROR ${r.file}: ${msg}`);
      errorCount += 1;
    }
  }
  return errorCount;
}

if (command === 'validate') {
  const { loaded, parseErrors } = loadCases(casesDir);
  const { steps, errorCount: stepErrors } = stepsRegistry();
  const { errorCount: templateErrors } = templatesRegistry(steps);
  const { results } = validateCaseSet(loaded, { bedUsers: bed?.users, steps });
  let errorCount = reportValidation(results, parseErrors) + stepErrors + templateErrors;
  if (flags.intent) {
    const { stale, missing } = checkStale(loaded, loadIntentDir(flags.intent));
    for (const s of stale) {
      console.error(`warn  ${s.file}: ${s.caseId} is STALE — intent "${s.intent}" is now ${s.liveHash}, case was compiled from ${s.caseHash}`);
    }
    for (const m of missing) {
      console.error(`ERROR ${m.file}: ${m.caseId} — intent section "${m.intent}" no longer exists`);
      errorCount += 1;
    }
  }
  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s) across ${loaded.length + parseErrors.length} file(s) — refused`);
    process.exit(1);
  }
  process.exit(0);
} else if (command === 'compile') {
  if (!flags.out) {
    console.error('peira compile needs --out <dir>');
    process.exit(2);
  }
  const intentDir = positionals[0] ?? 'intent';
  const allSections = loadIntentDir(intentDir);
  const fullDocument = allSections.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n');
  let sections = allSections;
  if (flags.section?.length) {
    const wanted = new Set(flags.section);
    sections = allSections.filter((s) => wanted.has(s.id));
    const known = new Set(allSections.map((s) => s.id));
    for (const id of wanted) {
      if (!known.has(id)) {
        console.error(`no intent section "${id}" — known: ${[...known].join(', ')}`);
        process.exit(2);
      }
    }
  }
  const stepsDir = flags.steps ?? join(flags.out, 'steps');
  const templatesDir = flags.templates ?? join(flags.out, 'templates');
  const { steps: existingSteps } = loadSteps(stepsDir);
  const { accepted, acceptedSteps, acceptedTemplates, manifest } = await compileSections(sections, {
    llm: claudeCliTransport(),
    bedUsers: bed?.users,
    steps: existingSteps,
    fullDocument,
    model: COMPILE_MODEL,
    onProgress: (msg) => console.error(msg),
  });
  mkdirSync(flags.out, { recursive: true });
  // targeted recompile: merge into the existing manifest and remove the superseded case files
  const manifestPath = join(flags.out, 'compile-manifest.json');
  let finalManifest = manifest;
  if (flags.section?.length) {
    let previous = null;
    try {
      previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      // no prior manifest — a targeted compile into a fresh dir is just a small full compile
    }
    if (previous) {
      const recompiled = new Set(sections.map((s) => s.id));
      const { rmSync } = await import('node:fs');
      for (const entry of previous.sections.filter((s) => recompiled.has(s.id))) {
        for (const staleId of entry.cases ?? []) {
          rmSync(join(flags.out, `${staleId}.json`), { force: true });
        }
        for (const staleStep of entry.steps ?? []) {
          rmSync(join(stepsDir, `${staleStep}.json`), { force: true });
        }
        for (const staleTpl of entry.templates ?? []) {
          rmSync(join(templatesDir, `${staleTpl}.json`), { force: true });
        }
      }
      finalManifest = {
        ...previous,
        model: manifest.model,
        contractHash: manifest.contractHash,
        sections: previous.sections.map((entry) => (recompiled.has(entry.id) ? manifest.sections.find((s) => s.id === entry.id) : entry)),
      };
    }
  }
  for (const { caseObj } of accepted) {
    writeFileSync(join(flags.out, `${caseObj.id}.json`), JSON.stringify(caseObj, null, 2) + '\n');
  }
  if (acceptedSteps.length > 0) mkdirSync(stepsDir, { recursive: true });
  for (const { stepObj } of acceptedSteps) {
    writeFileSync(join(stepsDir, `${stepObj.id}.json`), JSON.stringify(stepObj, null, 2) + '\n');
  }
  if (acceptedTemplates.length > 0) mkdirSync(templatesDir, { recursive: true });
  for (const { tplObj } of acceptedTemplates) {
    writeFileSync(join(templatesDir, `${tplObj.id}.json`), JSON.stringify(tplObj, null, 2) + '\n');
  }
  writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2) + '\n');
  const outcomes = manifest.sections.reduce((acc, s) => ((acc[s.outcome] = (acc[s.outcome] ?? 0) + 1), acc), {});
  const extras = [
    acceptedSteps.length > 0 ? `${acceptedSteps.length} step(s)` : null,
    acceptedTemplates.length > 0 ? `${acceptedTemplates.length} template(s)` : null,
  ].filter(Boolean).map((s) => ` + ${s}`).join('');
  console.log(`compiled ${accepted.length} case(s)${extras} from ${sections.length} section(s) → ${flags.out}`);
  console.log(`sections: ${JSON.stringify(outcomes)} | manifest: ${join(flags.out, 'compile-manifest.json')}`);
  const failedTransport = manifest.sections.some((s) => s.outcome === 'transport-error');
  process.exit(failedTransport ? 1 : 0);
} else if (command === 'stats') {
  const { loaded, parseErrors } = loadCases(casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  const { steps } = stepsRegistry();
  console.log(formatStats(computeStats(loaded, steps)));
  process.exit(parseErrors.length > 0 ? 1 : 0);
} else if (command === 'run') {
  if (!bed && !flags['base-url']) {
    console.error('peira run needs --bed <path> (or at minimum --base-url <url>)');
    process.exit(2);
  }
  const { loaded, parseErrors } = loadCases(casesDir);
  const { steps, errorCount: stepErrors } = stepsRegistry();
  const { templates, errorCount: templateErrors } = templatesRegistry(steps);
  const { results, ok } = validateCaseSet(loaded, { bedUsers: bed?.users, steps });
  const errorCount = reportValidation(results, parseErrors) + stepErrors + templateErrors;
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
    steps,
    templates,
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
  console.error('usage: peira <validate|run|compile|stats> [dir] [--bed <path>] [--intent <dir>] [--steps <dir>] [--out <dir>] [--section <id>] [--base-url <url>] [--seed <n>] [--evidence <path>]');
  process.exit(2);
}
