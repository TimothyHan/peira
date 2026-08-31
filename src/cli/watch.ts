// Watch-mode plumbing for `peira run --watch`. The decision logic (planReaction) is pure so
// it can be tested without a filesystem; the watchers and debounce live here too.
//
// The mapping is smarter than an import graph because lineage is first-class:
//   - a case file changed        → re-run exactly those cases
//   - bed / steps / templates    → re-run everything (they can affect any case)
//   - intent changed             → verdicts cannot change (the runner never reads intent);
//                                  report stale flags instead — recompiling is an LLM act
//                                  the human triggers, never a save hook.

import { watch, readdirSync, statSync, type FSWatcher } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export interface WatchTargets {
  casesDir: string;
  bedPath?: string;
  intentDir?: string;
  stepsDir?: string;
  templatesDir?: string;
  /** outputs this run writes — never react to them */
  ignore?: Array<string | undefined>;
}

export interface Reaction {
  /** 'all' = full re-run; 'changed' = only caseFiles; 'none' = nothing runnable changed */
  rerun: 'all' | 'changed' | 'none';
  /** absolute paths of changed case files (when rerun === 'changed') */
  caseFiles: string[];
  /** intent text changed — re-check staleness and report */
  checkIntent: boolean;
}

const within = (child: string, dir: string | undefined): boolean =>
  dir !== undefined && (child === resolve(dir) || child.startsWith(resolve(dir) + sep));

/** Decide what a batch of changed paths means. Pure. */
export function planReaction(changedPaths: string[], targets: WatchTargets): Reaction {
  const ignore = new Set((targets.ignore ?? []).filter((p): p is string => p !== undefined).map((p) => resolve(p)));
  const reaction: Reaction = { rerun: 'none', caseFiles: [], checkIntent: false };

  for (const raw of changedPaths) {
    const path = resolve(raw);
    if (ignore.has(path)) continue;
    if (targets.bedPath && path === resolve(targets.bedPath)) {
      reaction.rerun = 'all';
      continue;
    }
    if (within(path, targets.intentDir)) {
      if (path.endsWith('.md')) reaction.checkIntent = true;
      continue;
    }
    if (within(path, targets.stepsDir) || within(path, targets.templatesDir)) {
      if (path.endsWith('.json')) reaction.rerun = 'all';
      continue;
    }
    // registries defaulted inside the cases dir count as registry changes, not case changes
    if (within(path, join(targets.casesDir, 'steps')) || within(path, join(targets.casesDir, 'templates'))) {
      if (path.endsWith('.json')) reaction.rerun = 'all';
      continue;
    }
    if (within(path, targets.casesDir) && path.endsWith('.json')) {
      if (reaction.rerun !== 'all') reaction.rerun = 'changed';
      reaction.caseFiles.push(path);
    }
  }
  if (reaction.rerun === 'all') reaction.caseFiles = [];
  return reaction;
}

function subdirsOf(dir: string): string[] {
  const out = [dir];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...subdirsOf(join(dir, entry.name)));
  }
  return out;
}

/**
 * Watch a file or directory tree; `onChange` receives absolute paths. Uses recursive watch
 * where the platform supports it, else watches every subdirectory (rescanned per event batch
 * is overkill — new subdirectories require a watch restart, an accepted v1 limit).
 */
export function watchTree(target: string, onChange: (path: string) => void): FSWatcher[] {
  const isDir = statSync(target).isDirectory();
  const handler = (base: string) => (_event: string, filename: string | Buffer | null) => {
    onChange(filename ? join(base, String(filename)) : base);
  };
  if (!isDir) {
    return [watch(target, () => onChange(resolve(target)))];
  }
  try {
    return [watch(target, { recursive: true }, handler(target))];
  } catch {
    return subdirsOf(target).map((dir) => watch(dir, handler(dir)));
  }
}

/** Batch rapid-fire events: call `push` per event; `flush` fires once things settle. */
export function debounced(flush: (paths: string[]) => void, delayMs = 200): (path: string) => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (path: string) => {
    pending.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      timer = null;
      flush(batch);
    }, delayMs);
  };
}
