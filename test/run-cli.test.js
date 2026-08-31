// CLI-level behaviors of `peira run` that unit tests on runCases cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, '..', 'bin', 'peira.js');
const casesDir = join(here, '..', 'cases');

test('an unreachable service at bed.reset is a clean infra error, never a stack trace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-run-cli-'));
  const bedPath = join(dir, 'bed.json');
  writeFileSync(bedPath, JSON.stringify({
    baseUrl: 'http://127.0.0.1:9', // discard port — nothing listens
    users: { user_1: { username: 'user_1', password: 'pass_1' }, user_2: { username: 'user_2', password: 'pass_2' } },
    reset: { method: 'post', url: '/__reset' },
  }));
  const result = await execFileP('node', [binPath, 'run', casesDir, '--bed', bedPath, '--only', 'CASE-2022-1-1'], { encoding: 'utf8' })
    .catch((err) => err); // non-zero exit rejects; the error carries stdout/stderr
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ERROR bed\.reset/);
  assert.match(result.stderr, /nothing was run/);
  assert.ok(!/at httpRequest/.test(result.stderr), 'no stack trace on an unreachable service');
});

test('color codes never reach piped output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-run-cli-'));
  const bedPath = join(dir, 'bed.json');
  writeFileSync(bedPath, JSON.stringify({ baseUrl: 'http://127.0.0.1:9' }));
  const result = await execFileP('node', [binPath, 'run', casesDir, '--bed', bedPath, '--only', 'CASE-2022-1-1'], { encoding: 'utf8' })
    .catch((err) => err);
  assert.ok(!/\x1b\[/.test(result.stdout + result.stderr), 'piped output must be plain text');
});
