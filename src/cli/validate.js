import { loadCases } from '../load.js';
import { validateCaseSet } from '../validate.js';
import { loadIntentDir, lintIntent } from '../intent.js';
import { checkStale } from '../stale.js';

export async function main(ctx) {
  const { flags, casesDir, bed } = ctx;
  const { loaded, parseErrors } = loadCases(casesDir);
  const { steps, errorCount: stepErrors } = ctx.stepsRegistry();
  const { errorCount: templateErrors } = ctx.templatesRegistry(steps);
  const { results } = validateCaseSet(loaded, { bedUsers: bed?.users, steps });
  let errorCount = ctx.reportValidation(results, parseErrors) + stepErrors + templateErrors;

  if (flags.intent) {
    const sections = loadIntentDir(flags.intent);
    for (const msg of lintIntent(sections)) console.error(`warn  intent: ${msg}`);
    const { stale, missing } = checkStale(loaded, sections);
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
    return 1;
  }
  return 0;
}
