import { loadCases } from '../load.js';
import { validateCaseSet } from '../validate.js';
import { runCases } from '../runner.js';
import { httpRequest } from '../http.js';

export async function main(ctx) {
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
  return counts.fail + counts.error > 0 ? 1 : 0;
}
