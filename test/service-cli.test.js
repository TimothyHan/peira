// bed.service — `peira run` starts (or reuses) the application under test, and never leaks
// what it started. All CLI-level: the semantics live in process lifecycle, not in a function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixtures/server.js';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, '..', 'bin', 'peira.js');
const serverPath = join(here, 'fixtures', 'server.js');
const casesDir = join(here, '..', 'cases');

const USERS = { user_1: { username: 'user_1', password: 'pass_1' }, user_2: { username: 'user_2', password: 'pass_2' } };

function writeBed(service, port) {
  const dir = mkdtempSync(join(tmpdir(), 'peira-service-'));
  const bedPath = join(dir, 'bed.json');
  writeFileSync(bedPath, JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, users: USERS, service }));
  return bedPath;
}

async function portAnswers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

const run = (bedPath) =>
  execFileP('node', [binPath, 'run', casesDir, '--bed', bedPath, '--seed', '42', '--only', 'CASE-2022-1-1'], { encoding: 'utf8' })
    .catch((err) => err);

test('service.command is started, awaited until ready, and killed after the run', async () => {
  const port = 4611;
  const bedPath = writeBed({ command: `node ${serverPath} ${port}`, readyMs: 10000 }, port);
  assert.equal(await portAnswers(port), false, `port ${port} must be free before the test`);
  const r = await run(bedPath);
  assert.equal(r.code ?? 0, 0, r.stderr);
  assert.match(r.stdout, /service: started/);
  assert.match(r.stdout, /1 pass/);
  // the started process group must be gone — no leaked server
  for (let i = 0; i < 20 && (await portAnswers(port)); i += 1) await new Promise((s) => setTimeout(s, 100));
  assert.equal(await portAnswers(port), false, 'service leaked after the run');
});

test('reuse (default): an already-answering baseUrl is used as-is and never killed', async () => {
  const fixture = await startFixture();
  try {
    // the command would fail loudly if spawned — reuse means it must never run
    const bedPath = writeBed({ command: 'definitely-not-a-real-command-xyz' }, fixture.port);
    const r = await run(bedPath);
    assert.equal(r.code ?? 0, 0, r.stderr);
    assert.match(r.stdout, /service: reusing/);
    assert.equal(await portAnswers(fixture.port), true, 'a reused service must not be killed');
  } finally {
    await fixture.close();
  }
});

test('reuse:false refuses an instance Peira did not start', async () => {
  const fixture = await startFixture();
  try {
    const bedPath = writeBed({ command: 'true', reuse: false }, fixture.port);
    const r = await run(bedPath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /reuse is false/);
    assert.match(r.stderr, /nothing was run/);
  } finally {
    await fixture.close();
  }
});

test('a service that never answers is a clean infra error, not a hang or a stack trace', async () => {
  const port = 4613;
  const bedPath = writeBed({ command: 'sleep 60', readyMs: 700 }, port);
  const r = await run(bedPath);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /did not answer within 700ms/);
  assert.ok(!/at startService/.test(r.stderr), 'no stack trace');
});

test('a command that dies before answering reports the exit, not a timeout', async () => {
  const port = 4614;
  const bedPath = writeBed({ command: 'false', readyMs: 10000 }, port);
  const r = await run(bedPath);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exited before/);
});
