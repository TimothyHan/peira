// The Akela launcher (per akela's docs/embedding.md): Peira is a domain-pack consumer, the way
// QABuddy is. This bridge generates `akela.json` from Peira's own layout on first use, maps the
// environment (AKELA_CWD), and delegates by spawning akela's bin — process isolation keeps its
// fatal `process.exit` away from ours, and ESM/CJS never meet.
//
// akela is a FIRST-PARTY dependency (same author, itself dependency-free): the old "zero
// runtime dependencies" discipline survives in spirit as "no third-party code on the trust path".

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Inline pack fields (akela layers these over its default pack). One vocabulary, versioned here. */
export const PEIRA_AKELA_CONFIG = {
  domain: 'default',
  knowledge: [{ path: 'intent', namespace: 'PEIRA', untagged: 'derive' }],
  learnings: 'akela/LEARNINGS.md',
  runs: '.akela/runs',
  idTag: 'peira',
  activities: ['run', 'compile', 'triage', 'adopt'],
  statuses: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'],
  fingerprints: ['bed-artifact', 'stale-lineage', 'misadjudication', 'weak-oracle'],
};

export function akelaBin() {
  try {
    return createRequire(import.meta.url).resolve('akela/bin/akela.js');
  } catch {
    return null;
  }
}

export class AkelaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AkelaError';
  }
}

/** Run one akela command against `root`. Throws AkelaError on nonzero exit. */
export function runAkela(root, args) {
  const bin = akelaBin();
  if (!bin) throw new AkelaError('the akela package is not installed');
  const res = spawnSync(process.execPath, [bin, ...args], {
    env: { ...process.env, AKELA_CWD: root },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new AkelaError(`akela ${args[0]} failed: ${(res.stderr || res.stdout || '').trim().slice(0, 400)}`);
  }
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Generate akela.json (+ the learnings file akela expects) on first use. Never overwrites. */
export function ensureAkelaConfig(root, { intentDir = 'intent' } = {}) {
  const configPath = join(root, 'akela.json');
  let created = false;
  if (!existsSync(configPath)) {
    const config = { ...PEIRA_AKELA_CONFIG, knowledge: [{ ...PEIRA_AKELA_CONFIG.knowledge[0], path: intentDir }] };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    created = true;
  }
  const learningsPath = join(root, PEIRA_AKELA_CONFIG.learnings);
  if (!existsSync(learningsPath)) {
    mkdirSync(dirname(learningsPath), { recursive: true });
    writeFileSync(learningsPath, '# Learnings\n\nOne `## LRN-YYYYMMDD-NN: title` block per learning. Fields: Status · Scope · Statement · Overrides · Evidence · Fingerprint (optional) · Profile (optional).\n');
  }
  return { configPath, created };
}

/**
 * Record one Peira run into Akela: open a run, log the deduped section evidence, close with an
 * outcome. Deterministic file operations only — no model anywhere near this path.
 * @param {string} root project root (where akela.json lives)
 * @param {{seed: number, activity?: string, applied: string[], contradicted: Array<{src: string, note: string}>, status: string}} opts
 */
export function recordRun(root, { seed, activity = 'run', applied, contradicted, status }) {
  const runId = runAkela(root, ['run-id', '--activity', activity, '--task', `seed-${seed}`]).stdout.trim().split('\n')[0];
  if (!runId) throw new AkelaError('akela run-id produced no run id');
  for (const src of applied) {
    runAkela(root, ['log', 'applied', src, '--run', runId, '--activity', activity]);
  }
  for (const { src, note } of contradicted) {
    runAkela(root, ['log', 'contradicted', src, '--note', note, '--run', runId, '--activity', activity]);
  }
  runAkela(root, ['log', 'outcome', '--status', status, '--run', runId, '--activity', activity]);
  return { run: runId, applied: applied.length, contradicted: contradicted.length, status };
}

/** Outcome status for a run, from its verdict counts. */
export function outcomeStatus(counts) {
  if (counts.error > 0 && counts.pass === 0 && counts.fail === 0) return 'BLOCKED';
  if (counts.fail > 0 || counts.error > 0) return 'DONE_WITH_CONCERNS';
  return 'DONE';
}
