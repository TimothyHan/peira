// CLI dispatcher — each command lives in src/cli/<command>.ts; bin/peira.js is a thin shim
// over the compiled build of this module.

import { buildContext, USAGE } from './context.js';

const COMMANDS: Record<string, () => Promise<{ main: (ctx: ReturnType<typeof buildContext>) => Promise<number> }>> = {
  validate: () => import('./validate.js'),
  run: () => import('./run.js'),
  compile: () => import('./compile.js'),
  stats: () => import('./stats.js'),
  triage: () => import('./triage.js'),
  evidence: () => import('./evidence.js'),
  trust: () => import('./trust.js'),
  render: () => import('./render.js'),
  adopt: () => import('./adopt.js'),
};

const ctx = buildContext(process.argv);
if (ctx.command === 'help' || ctx.command === '--help' || ctx.command === '-h') {
  console.log(USAGE);
  process.exit(0);
}
const load = ctx.command ? COMMANDS[ctx.command] : undefined;
if (!load) {
  console.error(USAGE);
  process.exit(2);
}
const { main } = await load();
process.exit(await main(ctx));
