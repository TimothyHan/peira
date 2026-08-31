// The tarball cannot silently grow: npm pack contents are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('npm pack ships exactly bin + dist + schema + README + package.json', async () => {
  const { stdout } = await promisify(execFile)('npm', ['pack', '--dry-run', '--json'], { cwd: root });
  const [report] = JSON.parse(stdout);
  const files = report.files.map((f) => f.path).sort();
  // LICENSE ships whatever the `files` field says — npm always includes it
  const allowed = /^(package\.json|README\.md|LICENSE|bin\/peira\.js|dist\/(cli\/)?[a-z-]+\.(js|d\.ts)|schema\/[a-z.]+\.schema\.json)$/;
  for (const file of files) {
    assert.match(file, allowed, `unexpected file in tarball: ${file}`);
  }
  for (const required of ['bin/peira.js', 'dist/runner.js', 'dist/runner.d.ts', 'dist/compile.js', 'dist/triage.js', 'dist/ledger.js', 'dist/cli/main.js', 'dist/index.js', 'dist/index.d.ts', 'schema/case.schema.json', 'schema/step.schema.json', 'schema/triage.schema.json', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(required), `missing from tarball: ${required}`);
  }
  assert.ok(!files.some((f) => f.startsWith('src/')), 'TypeScript sources do not ship — dist is the artifact');
});
