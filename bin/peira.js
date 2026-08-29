#!/usr/bin/env node
// Thin dispatcher — each command lives in src/cli/<command>.js.

import { buildContext, USAGE } from '../src/cli/context.js';

const COMMANDS = {
  validate: () => import('../src/cli/validate.js'),
  run: () => import('../src/cli/run.js'),
  compile: () => import('../src/cli/compile.js'),
  stats: () => import('../src/cli/stats.js'),
  triage: () => import('../src/cli/triage.js'),
  evidence: () => import('../src/cli/evidence.js'),
  render: () => import('../src/cli/render.js'),
  adopt: () => import('../src/cli/adopt.js'),
};

const ctx = buildContext(process.argv);
if (ctx.command === 'help' || ctx.command === '--help' || ctx.command === '-h') {
  console.log(USAGE);
  process.exit(0);
}
const load = COMMANDS[ctx.command];
if (!load) {
  console.error(USAGE);
  process.exit(2);
}
const { main } = await load();
process.exit(await main(ctx));
