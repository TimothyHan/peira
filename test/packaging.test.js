// The tarball cannot silently grow: npm pack contents are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('npm pack ships exactly bin + src + schema + README + package.json', async () => {
  const { stdout } = await promisify(execFile)('npm', ['pack', '--dry-run', '--json'], { cwd: root });
  const [report] = JSON.parse(stdout);
  const files = report.files.map((f) => f.path).sort();
  const allowed = /^(package\.json|README\.md|bin\/peira\.js|src\/[a-z-]+\.js|schema\/[a-z.]+\.schema\.json)$/;
  for (const file of files) {
    assert.match(file, allowed, `unexpected file in tarball: ${file}`);
  }
  for (const required of ['bin/peira.js', 'src/runner.js', 'src/compile.js', 'src/triage.js', 'src/akela.js', 'schema/case.schema.json', 'schema/step.schema.json', 'schema/triage.schema.json', 'README.md']) {
    assert.ok(files.includes(required), `missing from tarball: ${required}`);
  }
});
