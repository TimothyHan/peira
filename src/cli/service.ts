// bed.service — start the application under test for `peira run` (the Playwright-webServer
// convenience, bed-flavored). Only `run` manages processes; read-only commands never spawn.
//
// Semantics: with reuse (default true), a baseUrl that already answers is used as-is and
// never killed. Otherwise the command is spawned in its own process group and the WHOLE
// group is killed at the end — a shell command's real server is a child of the shell, and
// killing just the shell is the classic leaked-server bug. Ready = any HTTP response at
// baseUrl (a 404 proves something is listening; connection-refused does not).

import { spawn, type ChildProcess } from 'node:child_process';
import { POLL_INTERVAL_MS, SERVICE_READY_TIMEOUT_MS } from '../constants.js';
import { httpRequest } from '../http.js';
import type { BedConfig } from '../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function answering(baseUrl: string): Promise<boolean> {
  try {
    await httpRequest({ baseUrl, method: 'get', route: '/', timeoutMs: 1000 });
    return true;
  } catch {
    return false;
  }
}

export interface RunningService {
  /** true when Peira spawned the process (and will kill it); false when reusing */
  started: boolean;
  stop: () => void;
}

/** Start (or reuse) the bed's service. Throws with a printable message on failure. */
export async function startService(service: NonNullable<BedConfig['service']>, baseUrl: string): Promise<RunningService> {
  const reuse = service.reuse ?? true;
  if (await answering(baseUrl)) {
    if (!reuse) {
      throw new Error(`service: ${baseUrl} already answers and service.reuse is false — refusing to test an instance Peira did not start`);
    }
    return { started: false, stop: () => {} };
  }

  const child: ChildProcess = spawn(service.command, {
    shell: true,
    cwd: service.cwd,
    detached: true, // its own process group, so stop() can kill the command's children too
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const stop = (): void => {
    if (exited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // the group is already gone — nothing to leak
    }
  };
  // a run interrupted mid-flight must not leak the server (watch mode lives on Ctrl-C)
  process.on('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stop();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  const readyMs = service.readyMs ?? SERVICE_READY_TIMEOUT_MS;
  const deadline = performance.now() + readyMs;
  for (;;) {
    if (exited) {
      throw new Error(`service: command exited before ${baseUrl} answered — "${service.command}"`);
    }
    if (await answering(baseUrl)) return { started: true, stop };
    if (performance.now() >= deadline) {
      stop();
      throw new Error(`service: ${baseUrl} did not answer within ${readyMs}ms of starting "${service.command}"`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
