import { writeFileSync, readFileSync } from 'node:fs';
import { loadCases } from '../load.js';
import { loadIntentDir } from '../intent.js';
import { renderDocument } from '../render.js';
import { INVARIANT_CASES_PER_RUN } from '../constants.js';

export async function main(ctx) {
  const { flags, casesDir } = ctx;
  const { loaded, parseErrors } = loadCases(casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  const { steps } = ctx.stepsRegistry();
  const { templates } = ctx.templatesRegistry(steps);
  const markdown = renderDocument({
    loaded,
    steps,
    templates,
    sections: flags.intent ? loadIntentDir(flags.intent) : undefined,
    evidenceText: flags.evidence ? readFileSync(flags.evidence, 'utf8') : undefined,
    perTemplate: INVARIANT_CASES_PER_RUN,
  });
  if (flags.out) {
    writeFileSync(flags.out, markdown + '\n');
    console.error(`rendered → ${flags.out}`);
  } else {
    console.log(markdown);
  }
  return parseErrors.length > 0 ? 1 : 0;
}
