import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCases } from '../load.js';
import { validateCaseSet } from '../validate.js';
import { runCases } from '../runner.js';
import { junitXml } from '../report-junit.js';
import { httpRequest } from '../http.js';
import type { CliContext } from './context.js';

export async function main(ctx: CliContext): Promise<number> {
  const { flags, casesDir, bed } = ctx;
  if (!bed && !flags['base-url']) {
    console.error('peira run needs --bed <path> (or at minimum --base-url <url>)');
    return 2;
  }
  const { loaded, parseErrors } = loadCases(casesDir);
  const { steps, errorCount: stepErrors } = ctx.stepsRegistry();
  const { templates, errorCount: templateErrors } = ctx.templatesRegistry(steps);
  const { results, ok } = validateCaseSet(loaded, { bedUsers: bed?.users, steps });
  const errorCount = ctx.reportValidation(results, parseErrors) + stepErrors + templateErrors;
  if (errorCount > 0 || !ok) {
    console.error('\nvalidation failed — nothing was run');
    return 1;
  }

  const baseUrl = (flags['base-url'] ?? bed?.baseUrl)!;

  // run-time selection: exact ids (--only) unioned with an id-substring (--grep); the whole
  // set was already validated above — filtering narrows execution, never the gate
  const only = flags.only ?? [];
  const grep = flags.grep;
  const filter = only.length > 0 || grep !== undefined
    ? (id: string) => only.includes(id) || (grep !== undefined && id.includes(grep))
    : undefined;
  if (filter) {
    const matched = loaded.filter(({ caseObj }) => filter(caseObj.id)).length;
    if (matched === 0 && templates.size === 0) {
      console.error(`no case matched${only.length ? ` --only ${only.join(', ')}` : ''}${grep !== undefined ? ` --grep "${grep}"` : ''} (${loaded.length} cases loaded)`);
      return 2;
    }
    console.log(`selected ${matched} of ${loaded.length} cases`);
  }

  const parallel = flags.parallel !== undefined ? Number(flags.parallel) : 1;
  if (!Number.isInteger(parallel) || parallel < 1) {
    console.error(`--parallel must be a positive integer, got "${flags.parallel}"`);
    return 2;
  }

  if (bed?.reset?.url) {
    await httpRequest({ baseUrl, method: bed.reset.method ?? 'post', route: bed.reset.url });
  }

  const seed = flags.seed !== undefined ? Number(flags.seed) : Math.floor(Math.random() * 2 ** 32);
  const result = await runCases(loaded, {
    bed: bed ?? { users: {} },
    baseUrl,
    seed,
    evidencePath: flags.evidence ?? null,
    steps,
    templates,
    filter,
    parallel,
  });
  const { verdicts, counts } = result;

  if (flags.junit) {
    mkdirSync(dirname(flags.junit), { recursive: true });
    writeFileSync(flags.junit, junitXml(result));
  }

  for (const v of verdicts) {
    const line = `${v.verdict.toUpperCase().padEnd(5)} ${v.id}${v.reason ? ` — ${v.reason}` : ''}`;
    (v.verdict === 'pass' ? console.log : console.error)(line);
    for (const d of v.diffs ?? []) {
      console.error(`        ${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)} (${d.reason})`);
    }
  }
  console.log(`\nseed ${seed} | ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error`);
  return counts.fail + counts.error > 0 ? 1 : 0;
}
