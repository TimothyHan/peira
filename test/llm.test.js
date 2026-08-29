// The claude-CLI transport, exercised through a real spawn of a fake binary — offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { claudeCliTransport, TransportError } from '../src/llm.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, 'fixtures', 'fake-claude.js');
chmodSync(fakeBin, 0o755);

test('the prompt travels over stdin and stdout comes back verbatim', async () => {
  process.env.FAKE_CLAUDE_ECHO = '1';
  try {
    const llm = claudeCliTransport({ bin: fakeBin });
    const out = await llm('MARKER-12345 compile this');
    assert.ok(out.includes('MARKER-12345'));
  } finally {
    delete process.env.FAKE_CLAUDE_ECHO;
  }
});

test('a nonzero exit becomes a TransportError carrying stderr', async () => {
  process.env.FAKE_CLAUDE_EXIT = '3';
  try {
    const llm = claudeCliTransport({ bin: fakeBin });
    await assert.rejects(() => llm('x'), (err) => err instanceof TransportError && /simulated failure/.test(err.message));
  } finally {
    delete process.env.FAKE_CLAUDE_EXIT;
  }
});

test('a missing binary becomes a TransportError, not a crash', async () => {
  const llm = claudeCliTransport({ bin: '/nonexistent/claude' });
  await assert.rejects(() => llm('x'), TransportError);
});

test('CLI smoke: peira compile with the fake binary writes cases and a complete manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-compile-'));
  const intentDir = join(dir, 'intent');
  const outDir = join(dir, 'out');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(intentDir, { recursive: true });
  writeFileSync(join(intentDir, 'plan.md'), '## Thing works\n\nThe thing should work.\n');

  const binPath = join(here, '..', 'bin', 'peira.js');
  await promisify(execFile)(process.execPath, [binPath, 'compile', intentDir, '--out', outDir], {
    env: { ...process.env, PEIRA_CLAUDE_BIN: fakeBin },
  });

  const written = readdirSync(outDir).sort();
  assert.deepEqual(written, ['CASE-fake-001.json', 'compile-manifest.json']);
  const caseObj = JSON.parse(readFileSync(join(outDir, 'CASE-fake-001.json'), 'utf8'));
  assert.equal(caseObj.from.intent, 'thing-works');
  const manifest = JSON.parse(readFileSync(join(outDir, 'compile-manifest.json'), 'utf8'));
  assert.equal(manifest.sections.length, 1);
  assert.equal(manifest.sections[0].outcome, 'compiled');
  assert.equal(manifest.model, 'claude-opus-5');

  // targeted recompile (--section): superseded case files removed, manifest merged in place
  const replacement = {
    cases: [{
      id: 'CASE-fake-v2-001',
      title: 'recompiled case',
      test: { request: { method: 'get', route: '/thing' }, expect: { status: 200, body: { ok: true } } },
    }],
  };
  await promisify(execFile)(process.execPath, [binPath, 'compile', intentDir, '--out', outDir, '--section', 'thing-works'], {
    env: { ...process.env, PEIRA_CLAUDE_BIN: fakeBin, FAKE_CLAUDE_OUTPUT: JSON.stringify(replacement) },
  });
  assert.deepEqual(readdirSync(outDir).sort(), ['CASE-fake-v2-001.json', 'compile-manifest.json']);
  const merged = JSON.parse(readFileSync(join(outDir, 'compile-manifest.json'), 'utf8'));
  assert.deepEqual(merged.sections.map((s) => s.cases).flat(), ['CASE-fake-v2-001']);
});
