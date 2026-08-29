import { loadCases } from '../load.js';
import { computeStats, formatStats } from '../stats.js';

export async function main(ctx) {
  const { loaded, parseErrors } = loadCases(ctx.casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  const { steps } = ctx.stepsRegistry();
  console.log(formatStats(computeStats(loaded, steps)));
  return parseErrors.length > 0 ? 1 : 0;
}
