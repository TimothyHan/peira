// `peira init` — deterministic scaffolding: created files, the no-clobber guarantee, and a
// scaffold that the rest of the tool accepts without edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIntentDir } from '../dist/intent.js';
import { validateCase } from '../dist/validate.js';

const execFileP = promisify(execFile);
const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'peira.js');
const init = (dir, ...args) => execFileP('node', [binPath, 'init', dir, ...args], { encoding: 'utf8' });

test('init scaffolds bed, intent, AGENTS.md + CLAUDE.md import, cases dir; --ci adds the workflow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-init-'));
  const { stdout } = await init(dir, '--ci');
  for (const f of ['bed.json', 'intent/example.md', 'AGENTS.md', 'CLAUDE.md', '.github/workflows/api-tests.yml']) {
    assert.ok(existsSync(join(dir, f)), `missing ${f}`);
    assert.match(stdout, new RegExp(`created.*${f.split('/').pop()}`));
  }
  assert.ok(existsSync(join(dir, 'cases')), 'cases dir for compile --out');
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n'); // one source of truth
  assert.match(readFileSync(join(dir, '.github/workflows/api-tests.yml'), 'utf8'), /--junit junit\.xml/);
  assert.match(stdout, /next steps:/);

  // the scaffolded intent is real: two tagged sections the compiler can eat
  const sections = loadIntentDir(join(dir, 'intent'));
  assert.deepEqual(sections.map((s) => s.id).sort(), ['order-create', 'order-isolation']);
  assert.deepEqual(sections.map((s) => s.kind).sort(), ['ac', 'invariant']);
  // and the scaffolded bed parses as a bed ($comment is inert)
  const bed = JSON.parse(readFileSync(join(dir, 'bed.json'), 'utf8'));
  assert.equal(typeof bed.baseUrl, 'string');
  assert.deepEqual(validateCase({ id: 'CASE-x', from: { intent: 'x', hash: 'abcdef' }, test: { request: { method: 'get', route: '/x' }, expect: { status: 200, body: {} } } }, { bedUsers: bed.users }).errors, []);
});

test('init never overwrites: second run keeps every file byte-identical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-init-'));
  await init(dir);
  writeFileSync(join(dir, 'bed.json'), '{"baseUrl":"http://mine:9"}');
  const { stdout } = await init(dir);
  assert.match(stdout, /kept.*bed\.json/);
  assert.equal(readFileSync(join(dir, 'bed.json'), 'utf8'), '{"baseUrl":"http://mine:9"}');
});

test('an existing AGENTS.md is kept and the block is printed for appending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-init-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# my rules\n');
  const { stdout } = await init(dir);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), '# my rules\n');
  assert.match(stdout, /append this block/);
  assert.match(stdout, /peira reference/); // the block's first job: point the agent at the vocabulary
  assert.match(stdout, /from\.hash never is/);
});

test('an existing CLAUDE.md is kept with a hint to add the @AGENTS.md import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-init-'));
  writeFileSync(join(dir, 'CLAUDE.md'), '# my project\n');
  const { stdout } = await init(dir);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# my project\n');
  assert.match(stdout, /@AGENTS\.md/);
});

test('validate accepts a fresh scaffold: no cases yet is an empty set, not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peira-init-'));
  await init(dir);
  const r = await execFileP('node', [binPath, 'validate', join(dir, 'cases'), '--bed', join(dir, 'bed.json'), '--intent', join(dir, 'intent')], { encoding: 'utf8' }).catch((e) => e);
  assert.equal(r.code ?? 0, 0, r.stderr);
});
