import { readFileSync } from 'node:fs';
import { loadCases } from '../load.js';
import { computeStats, formatStats } from '../stats.js';
import { readOpenApiEndpoints, computeCoverage, formatCoverage } from '../coverage.js';
import type { CliContext } from './context.js';

export async function main(ctx: CliContext): Promise<number> {
  const { loaded, parseErrors } = loadCases(ctx.casesDir);
  for (const msg of parseErrors) console.error(`ERROR ${msg}`);
  const { steps } = ctx.stepsRegistry();
  console.log(formatStats(computeStats(loaded, steps)));

  if (ctx.flags.openapi) {
    let endpoints;
    try {
      endpoints = readOpenApiEndpoints(JSON.parse(readFileSync(ctx.flags.openapi, 'utf8')));
    } catch (err) {
      console.error(`ERROR --openapi ${ctx.flags.openapi}: ${(err as Error).message}`);
      return 2;
    }
    console.log('');
    console.log(formatCoverage(computeCoverage(loaded, endpoints)));
  }
  return parseErrors.length > 0 ? 1 : 0;
}
