// RFC 0004: the vocabulary has one source of truth, and everything that restates it agrees.
// This is the drift guard for the agent-facing surface — the class of bug that hit three
// times in one week (undocumented matchers, a stale command count, a scaffold contradicting
// a supported path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReference } from '../dist/reference.js';
import { MATCHERS } from '../dist/expect.js';
import { COMMAND_NAMES } from '../dist/cli/commands.js';
import { USAGE } from '../dist/cli/context.js';
import { CASE_SCHEMA } from '../dist/validate-core.js';
import { BED_SCHEMA } from '../dist/validate-bed.js';
import { buildContract } from '../dist/compile.js';
import { AGENT_INSTRUCTIONS } from '../dist/cli/init.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_MD = readFileSync(join(root, 'docs', 'REFERENCE.md'), 'utf8');
const MAIN_TS = readFileSync(join(root, 'src', 'cli', 'main.ts'), 'utf8');
const reference = renderReference({ version: '0.0.0-test' });

test('every schema property carries a description — the compile LLM reads the schema verbatim', () => {
  const missing = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      const target = v.$ref ? null : v;
      if (target && !target.description) missing.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
    for (const branch of node.anyOf ?? []) walk(branch, `${path}(anyOf)`);
    for (const [k, v] of Object.entries(node.$defs ?? {})) walk(v, `$defs.${k}`);
  };
  walk(CASE_SCHEMA, 'case');
  walk(BED_SCHEMA, 'bed');
  assert.deepEqual(missing, [], 'undescribed schema properties');
});

test('every matcher is in the reference, in REFERENCE.md, and in the compiler contract', () => {
  const contract = buildContract();
  for (const m of MATCHERS) {
    assert.ok(reference.includes(m.form), `reference lacks ${m.key}`);
    assert.ok(REFERENCE_MD.includes(m.key), `docs/REFERENCE.md lacks ${m.key}`);
    assert.ok(contract.includes(m.form), `compile contract lacks ${m.key}`);
  }
  // and the scaffold names every matcher an agent may use
  for (const m of MATCHERS) if (m.key !== 'null') assert.ok(AGENT_INSTRUCTIONS.includes(m.key), `AGENTS.md scaffold lacks ${m.key}`);
});

test('every command is dispatched, in USAGE, in the reference, and in REFERENCE.md', () => {
  for (const name of COMMAND_NAMES) {
    assert.match(MAIN_TS, new RegExp(`^\\s+${name}: \\(\\) => import\\('./${name}\\.js'\\),`, 'm'), `main.ts does not dispatch ${name}`);
    assert.match(USAGE, new RegExp(`^  ${name}\\b`, 'm'), `USAGE lacks ${name}`);
    assert.ok(reference.includes(`  ${name}`), `reference lacks ${name}`);
    assert.ok(REFERENCE_MD.includes(`\`${name}\``) || REFERENCE_MD.includes(`peira ${name}`), `docs/REFERENCE.md lacks ${name}`);
  }
  // and nothing is dispatched that the roster does not name
  const dispatched = [...MAIN_TS.matchAll(/^\s+(\w+): \(\) => import\('\.\/\w+\.js'\),/gm)].map((m) => m[1]);
  assert.deepEqual(dispatched.sort(), [...COMMAND_NAMES].sort());
});

test('every request and expect key is documented in REFERENCE.md', () => {
  const keys = [
    ...Object.keys(CASE_SCHEMA.$defs.request.properties).map((k) => `request.${k}`),
    ...Object.keys(CASE_SCHEMA.$defs.expect.properties).map((k) => `\`${k}\``),
    ...Object.keys(CASE_SCHEMA.$defs.step.properties).map((k) => `\`${k}\``),
  ];
  for (const k of keys) assert.ok(REFERENCE_MD.includes(k), `docs/REFERENCE.md lacks ${k}`);
});

test('the AGENTS.md scaffold points at the reference and no longer forbids hand-written cases', () => {
  assert.match(AGENT_INSTRUCTIONS, /peira reference/);
  assert.match(AGENT_INSTRUCTIONS, /peira stamp/);
  assert.doesNotMatch(AGENT_INSTRUCTIONS, /NEVER edit cases/);
  assert.match(AGENT_INSTRUCTIONS, /\{\{alias\}\}/);
});

test('peira reference runs and prints the installed version', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'bin', 'peira.js'), 'reference']);
  assert.match(stdout, /^# Peira reference — v\d+\.\d+\.\d+/);
  assert.ok(stdout.includes('$notContains') && stdout.includes('loginPrincipal') && stdout.includes('  stamp'));
});
