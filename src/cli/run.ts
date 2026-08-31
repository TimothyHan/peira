import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadCases } from '../load.js';
import { validateCaseSet } from '../validate.js';
import { runCases } from '../runner.js';
import { junitXml } from '../report-junit.js';
import { httpRequest } from '../http.js';
import { loadIntentDir } from '../intent.js';
import { checkStale } from '../stale.js';
import { verdictColor, yellow, dim } from './color.js';
import { planReaction, watchTree, debounced, type WatchTargets } from './watch.js';
import { startService, type RunningService } from './service.js';
import type { CliContext } from './context.js';

interface RunSetup {
  seed: number;
  baseUrl: string;
  parallel: number;
  shard?: { index: number; total: number };
}

/** One validate → reset → run → report cycle. `extraFilter` narrows a watch re-run. */
async function runOnce(ctx: CliContext, setup: RunSetup, extraFilter?: (file: string) => boolean): Promise<number> {
  const { flags, casesDir, bed } = ctx;
  const { loaded: loadedAll, parseErrors } = loadCases(casesDir);
  const { steps, errorCount: stepErrors } = ctx.stepsRegistry();
  const { templates, errorCount: templateErrors } = ctx.templatesRegistry(steps);
  const { results, ok } = validateCaseSet(loadedAll, { bedUsers: bed?.users, steps });
  const errorCount = ctx.reportValidation(results, parseErrors) + stepErrors + templateErrors;
  if (errorCount > 0 || !ok) {
    console.error('\nvalidation failed — nothing was run');
    return 1;
  }
  const loaded = extraFilter ? loadedAll.filter(({ file }) => extraFilter(resolve(file))) : loadedAll;

  // run-time selection: exact ids (--only) unioned with an id-substring (--grep); the whole
  // set was already validated above — filtering narrows execution, never the gate
  const only = flags.only ?? [];
  const grep = flags.grep;
  const filter = only.length > 0 || grep !== undefined
    ? (id: string) => only.includes(id) || (grep !== undefined && id.includes(grep))
    : undefined;
  if (filter) {
    const matched = loaded.filter(({ caseObj }) => filter(caseObj.id)).length;
    if (matched === 0 && templates.size === 0 && !extraFilter) {
      console.error(`no case matched${only.length ? ` --only ${only.join(', ')}` : ''}${grep !== undefined ? ` --grep "${grep}"` : ''} (${loaded.length} cases loaded)`);
      return 2;
    }
    console.log(`selected ${matched} of ${loaded.length} cases`);
  }

  if (bed?.reset?.url) {
    try {
      await httpRequest({ baseUrl: setup.baseUrl, method: bed.reset.method ?? 'post', route: bed.reset.url, timeoutMs: bed.timeouts?.requestMs });
    } catch (err) {
      // the service is unreachable before anything ran — report it like the error verdict it is
      console.error(verdictColor('error')(`ERROR bed.reset ${bed.reset.url}: ${(err as Error).message}`));
      console.error('the service never answered — nothing was run');
      return 1;
    }
  }

  const result = await runCases(loaded, {
    bed: bed ?? { users: {} },
    baseUrl: setup.baseUrl,
    seed: setup.seed,
    evidencePath: flags.evidence ?? null,
    steps,
    templates,
    filter,
    parallel: setup.parallel,
    shard: setup.shard,
  });
  const { verdicts, counts } = result;

  if (flags.junit) {
    mkdirSync(dirname(flags.junit), { recursive: true });
    writeFileSync(flags.junit, junitXml(result));
  }

  for (const v of verdicts) {
    const line = `${v.verdict.toUpperCase().padEnd(5)} ${v.id}${v.reason ? ` — ${v.reason}` : ''}`;
    (v.verdict === 'pass' ? console.log : console.error)(verdictColor(v.verdict)(line));
    for (const d of v.diffs ?? []) {
      console.error(dim(`        ${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)} (${d.reason})`));
    }
  }
  const shardTag = setup.shard ? ` | shard ${setup.shard.index}/${setup.shard.total}` : '';
  console.log(`\nseed ${setup.seed}${shardTag} | ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error (${(result.wallMs / 1000).toFixed(2)}s)`);
  return counts.fail + counts.error > 0 ? 1 : 0;
}

function reportStale(ctx: CliContext): void {
  if (!ctx.flags.intent) return;
  const { loaded } = loadCases(ctx.casesDir);
  const { stale, missing } = checkStale(loaded, loadIntentDir(ctx.flags.intent));
  for (const s of stale) {
    console.error(yellow(`stale ${s.file}: ${s.caseId} — intent "${s.intent}" is now ${s.liveHash}, case was compiled from ${s.caseHash}`));
  }
  for (const m of missing) {
    console.error(yellow(`stale ${m.file}: ${m.caseId} — intent section "${m.intent}" no longer exists`));
  }
  if (stale.length + missing.length > 0) {
    console.error(dim(`recompile when ready: peira compile ${ctx.flags.intent} --out ${ctx.casesDir}${ctx.flags.bed ? ` --bed ${ctx.flags.bed}` : ''} --section <id>`));
  } else {
    console.error(dim('intent changed — no case went stale'));
  }
}

async function watchLoop(ctx: CliContext, setup: RunSetup): Promise<never> {
  const { flags, casesDir } = ctx;
  const targets: WatchTargets = {
    casesDir,
    bedPath: flags.bed,
    intentDir: flags.intent,
    stepsDir: flags.steps,
    templatesDir: flags.templates,
    ignore: [flags.evidence, flags.junit],
  };
  const rerun = async (extraFilter?: (file: string) => boolean) => {
    try {
      await runOnce(ctx, setup, extraFilter);
    } catch (err) {
      console.error(verdictColor('error')(`ERROR ${(err as Error).message}`));
    }
  };

  let running = false;
  let queued: string[] | null = null;
  const react = async (paths: string[]) => {
    if (running) {
      queued = [...(queued ?? []), ...paths];
      return;
    }
    running = true;
    const plan = planReaction(paths, targets);
    if (plan.checkIntent) reportStale(ctx);
    if (plan.rerun === 'all') {
      console.log(dim('\n— change detected: full re-run —'));
      await rerun();
    } else if (plan.rerun === 'changed') {
      const files = new Set(plan.caseFiles);
      console.log(dim(`\n— change detected: re-running ${files.size} case file(s) —`));
      await rerun((file) => files.has(file));
    }
    running = false;
    if (queued) {
      const next = queued;
      queued = null;
      void react(next);
    }
  };

  const onEvent = debounced((paths) => void react(paths));
  const watchables = [casesDir, flags.bed, flags.intent, flags.steps, flags.templates]
    .filter((p): p is string => p !== undefined && existsSync(p));
  for (const target of watchables) watchTree(target, onEvent);

  console.log(dim(`\nwatching ${watchables.join(', ')} — seed ${setup.seed} pinned for this session (ctrl-c to exit)`));
  return new Promise<never>(() => {}); // runs until interrupted
}

export async function main(ctx: CliContext): Promise<number> {
  const { flags, bed } = ctx;
  if (!bed && !flags['base-url']) {
    console.error('peira run needs --bed <path> (or at minimum --base-url <url>)');
    return 2;
  }

  const parallel = flags.parallel !== undefined ? Number(flags.parallel) : 1;
  if (!Number.isInteger(parallel) || parallel < 1) {
    console.error(`--parallel must be a positive integer, got "${flags.parallel}"`);
    return 2;
  }

  let shard: RunSetup['shard'];
  if (flags.shard !== undefined) {
    const m = flags.shard.match(/^(\d+)\/(\d+)$/);
    const index = m ? Number(m[1]) : 0;
    const total = m ? Number(m[2]) : 0;
    if (!m || index < 1 || total < 1 || index > total) {
      console.error(`--shard must be <index>/<total> with 1 <= index <= total, got "${flags.shard}"`);
      return 2;
    }
    shard = { index, total };
  }

  const setup: RunSetup = {
    seed: flags.seed !== undefined ? Number(flags.seed) : Math.floor(Math.random() * 2 ** 32),
    baseUrl: (flags['base-url'] ?? bed?.baseUrl)!,
    parallel,
    shard,
  };

  if (flags.watch && (flags.junit || shard)) {
    console.error('--watch does not combine with --junit or --shard (those are CI shapes)');
    return 2;
  }

  let service: RunningService | null = null;
  if (bed?.service) {
    try {
      service = await startService(bed.service, setup.baseUrl);
      console.log(dim(service.started ? `service: started "${bed.service.command}" — ${setup.baseUrl} answering` : `service: reusing the instance already answering at ${setup.baseUrl}`));
    } catch (err) {
      console.error(verdictColor('error')(`ERROR ${(err as Error).message}`));
      console.error('nothing was run');
      return 1;
    }
  }

  try {
    const code = await runOnce(ctx, setup);
    if (!flags.watch) return code; // watch survives a red first run — fix, save, it re-runs
    return await watchLoop(ctx, setup); // the service lives for the whole watch session
  } finally {
    service?.stop();
  }
}
