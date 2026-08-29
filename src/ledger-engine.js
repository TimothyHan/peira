// The ledger engine launcher. Peira's evidence ledger is powered by akela — a FIRST-PARTY
// dependency (same author, itself dependency-free: the old "zero runtime dependencies"
// discipline survives in spirit as "no third-party code on the trust path"). The engine is an
// implementation detail: Peira's user-facing surface says "evidence ledger" and never the
// engine's name; the only artifact of it a user ever sees is the inert `akela.json` config
// this bridge generates, which they never edit.
//
// Mechanics (per the engine's docs/embedding.md): generate the config from Peira's own layout
// on first use, map the environment (AKELA_CWD), and delegate by spawning the engine's bin —
// process isolation keeps its fatal `process.exit` away from ours, and ESM/CJS never meet.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Inline pack fields (the engine layers these over its default pack). One vocabulary, versioned here. */
export const LEDGER_ENGINE_CONFIG = {
  domain: 'default',
  knowledge: [{ path: 'intent', namespace: 'PEIRA', untagged: 'derive' }],
  learnings: '.peira/LEARNINGS.md',
  runs: '.peira/runs',
  idTag: 'peira',
  activities: ['run', 'compile', 'triage', 'adopt'],
  statuses: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'],
  fingerprints: ['bed-artifact', 'stale-lineage', 'misadjudication', 'weak-oracle'],
};

export function engineBin() {
  try {
    return createRequire(import.meta.url).resolve('akela/bin/akela.js');
  } catch {
    return null;
  }
}

export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Run one ledger-engine command against `root`. Throws LedgerError on nonzero exit. */
export function runEngine(root, args) {
  const bin = engineBin();
  if (!bin) throw new LedgerError('the ledger engine is not installed — reinstall peira');
  const res = spawnSync(process.execPath, [bin, ...args], {
    env: { ...process.env, AKELA_CWD: root },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new LedgerError(`ledger ${args[0]} failed: ${(res.stderr || res.stdout || '').trim().slice(0, 400)}`);
  }
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Generate akela.json (+ the learnings file the engine expects) on first use. Never overwrites. */
export function ensureLedgerConfig(root, { intentDir = 'intent' } = {}) {
  const configPath = join(root, 'akela.json');
  let created = false;
  if (!existsSync(configPath)) {
    const config = { ...LEDGER_ENGINE_CONFIG, knowledge: [{ ...LEDGER_ENGINE_CONFIG.knowledge[0], path: intentDir }] };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    created = true;
  }
  const learningsPath = join(root, LEDGER_ENGINE_CONFIG.learnings);
  if (!existsSync(learningsPath)) {
    mkdirSync(dirname(learningsPath), { recursive: true });
    writeFileSync(learningsPath, '# Learnings\n\nOne `## LRN-YYYYMMDD-NN: title` block per learning. Fields: Status · Scope · Statement · Overrides · Evidence · Fingerprint (optional) · Profile (optional).\n');
  }
  return { configPath, created };
}

/**
 * Record one Peira run into the ledger: open a run, log the deduped section evidence, close
 * with an outcome. Deterministic file operations only — no model anywhere near this path.
 * @param {string} root project root (where akela.json lives)
 * @param {{seed: number, activity?: string, applied: string[], contradicted: Array<{src: string, note: string}>, status: string}} opts
 */
export function recordRun(root, { seed, activity = 'run', applied, contradicted, status }) {
  const runId = runEngine(root, ['run-id', '--activity', activity, '--task', `seed-${seed}`]).stdout.trim().split('\n')[0];
  if (!runId) throw new LedgerError('the ledger engine produced no run id');
  for (const src of applied) {
    runEngine(root, ['log', 'applied', src, '--run', runId, '--activity', activity]);
  }
  for (const { src, note } of contradicted) {
    runEngine(root, ['log', 'contradicted', src, '--note', note, '--run', runId, '--activity', activity]);
  }
  runEngine(root, ['log', 'outcome', '--status', status, '--run', runId, '--activity', activity]);
  return { run: runId, applied: applied.length, contradicted: contradicted.length, status };
}

/** Outcome status for a run, from its verdict counts. */
export function outcomeStatus(counts) {
  if (counts.error > 0 && counts.pass === 0 && counts.fail === 0) return 'BLOCKED';
  if (counts.fail > 0 || counts.error > 0) return 'DONE_WITH_CONCERNS';
  return 'DONE';
}
