// CLI dispatcher — each command lives in src/cli/<command>.ts; bin/peira.js is a thin shim
// over the compiled build of this module.

import { buildContext, USAGE } from './context.js';
import type { CommandName } from './commands.js';

// keyed by CommandName so adding a command without listing it in commands.ts is a type error
const COMMANDS: Record<CommandName, () => Promise<{ main: (ctx: ReturnType<typeof buildContext>) => Promise<number> }>> = {
  init: () => import('./init.js'),
  validate: () => import('./validate.js'),
  run: () => import('./run.js'),
  compile: () => import('./compile.js'),
  stats: () => import('./stats.js'),
  triage: () => import('./triage.js'),
  evidence: () => import('./evidence.js'),
  trust: () => import('./trust.js'),
  render: () => import('./render.js'),
  adopt: () => import('./adopt.js'),
  stamp: () => import('./stamp.js'),
  reference: () => import('./reference.js'),
};

const ctx = buildContext(process.argv);
if (ctx.command === 'help' || ctx.command === '--help' || ctx.command === '-h') {
  console.log(USAGE);
  process.exit(0);
}
const load = ctx.command ? COMMANDS[ctx.command as CommandName] : undefined;
if (!load) {
  console.error(USAGE);
  process.exit(2);
}
const { main } = await load();
process.exit(await main(ctx));
