import { writeFileSync, readFileSync } from 'node:fs';
import { loadCases } from '../load.js';
import { loadIntentDir } from '../intent.js';
import { renderDocument } from '../render.js';
import { renderHtmlDocument } from '../render-html.js';
import { INVARIANT_CASES_PER_RUN } from '../constants.js';

export async function main(ctx) {
  const { flags, casesDir } = ctx;
  const format = flags.format ?? (flags.out?.endsWith('.html') ? 'html' : 'md');
  if (!['md', 'html'].includes(format)) {
    console.error(`unknown --format "${format}" — md | html`);
    return 2;
  }
  const { loaded, parseErrors } = loadCases(casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  const { steps } = ctx.stepsRegistry();
  const { templates } = ctx.templatesRegistry(steps);
  const opts = {
    loaded,
    steps,
    templates,
    sections: flags.intent ? loadIntentDir(flags.intent) : undefined,
    evidenceText: flags.evidence ? readFileSync(flags.evidence, 'utf8') : undefined,
    triageProposals: flags.triage ? JSON.parse(readFileSync(flags.triage, 'utf8')) : undefined,
    perTemplate: INVARIANT_CASES_PER_RUN,
  };
  const rendered = format === 'html' ? renderHtmlDocument(opts) : renderDocument(opts);
  if (flags.out) {
    writeFileSync(flags.out, rendered + '\n');
    console.error(`rendered (${format}) → ${flags.out}`);
  } else {
    console.log(rendered);
  }
  return parseErrors.length > 0 ? 1 : 0;
}
