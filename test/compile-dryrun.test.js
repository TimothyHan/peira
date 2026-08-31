// `peira compile --dry-run`: the user-facing "how well does my intent compile?" check.
// Writes nothing, and surfaces the reasons that were previously buried in the manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, '..', 'bin', 'peira.js');
const fakeBin = join(here, 'fixtures', 'fake-claude.js');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'peira-dryrun-'));
  const intentDir = join(dir, 'intent');
  mkdirSync(intentDir);
  writeFileSync(join(intentDir, 'plan.md'), '## Creating an order\n<!-- peira: id=order-create kind=ac -->\n\nPOST /orders returns 201 with the new order id.\n');
  return { dir, intentDir, outDir: join(dir, 'cases') };
}

const compile = (p, ...args) => {
  chmodSync(fakeBin, 0o755);
  return execFileP('node', [binPath, 'compile', p.intentDir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PEIRA_CLAUDE_BIN: fakeBin },
  }).catch((e) => e);
};

test('--dry-run reports without writing anything', async () => {
  const p = project();
  const r = await compile(p, '--dry-run');
  assert.equal(r.code ?? 0, 0, r.stderr);
  assert.match(r.stdout, /would compile 1 case\(s\)/);
  assert.match(r.stdout, /nothing written \(--dry-run\)/);
  assert.ok(!existsSync(p.outDir), 'a dry run must not create the output directory');
  assert.ok(!/manifest:/.test(r.stdout), 'no manifest is written, so none is announced');
});

test('--dry-run needs no --out; a normal compile still does', async () => {
  const p = project();
  const dry = await compile(p, '--dry-run');
  assert.equal(dry.code ?? 0, 0);

  const wet = await compile(p); // no --out, no --dry-run
  assert.equal(wet.code, 2);
  assert.match(wet.stderr, /needs --out <dir> \(or --dry-run/);
});

test('a normal compile still writes cases and the manifest, and reports the same summary', async () => {
  const p = project();
  const r = await compile(p, '--out', p.outDir);
  assert.equal(r.code ?? 0, 0, r.stderr);
  assert.match(r.stdout, /compiled 1 case\(s\)/);
  assert.match(r.stdout, /sections: 1 compiled, 0 skipped, 0 refused/);
  assert.match(r.stdout, /manifest:/);
  assert.ok(readdirSync(p.outDir).some((f) => f.startsWith('CASE-')), 'cases written');
  assert.ok(existsSync(join(p.outDir, 'compile-manifest.json')));
});

test('the outcome line states the pass-rate over sections that made a testable claim', async () => {
  const p = project();
  const r = await compile(p, '--dry-run');
  assert.match(r.stdout, /100% of the 1 that stated a testable claim/);
});
