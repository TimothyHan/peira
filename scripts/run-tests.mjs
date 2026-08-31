// Portable test entry point. `node --test test/*.test.js` relies on the POSIX shell to expand
// the glob: cmd.exe does not, and node's own glob support only arrives in v21 — so that form
// silently failed on Windows with node 18 and 20. Handing node an explicit file list works
// identically everywhere.
//
// Passing files explicitly also avoids node's directory-discovery rules, which treat EVERY
// file under a `test/` directory as a test file — that would try to execute the canned
// `claude` stand-in, which blocks reading stdin.

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => join(testDir, f));

if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
