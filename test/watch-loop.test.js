// The watch LOOP end to end (planReaction is unit-tested in watch.test.js; this covers the
// chain it lives in): fs event → debounce → scoped re-run → session survives. Everything is
// poll-based with generous deadlines — never sleep-and-hope on watcher timing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixtures/server.js';

const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'peira.js');

const caseJson = (n, title) => JSON.stringify({
  id: `CASE-w${n}`,
  ...(title ? { title } : {}),
  from: { intent: 'watch', hash: 'abcdef' },
  test: {
    request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: 'nope' } },
    expect: { status: 400, body: { status: 400 } },
  },
});

test('watch mode: a case edit triggers a scoped re-run within the session', async () => {
  const fixture = await startFixture();
  const dir = mkdtempSync(join(tmpdir(), 'peira-watch-'));
  const casesDir = join(dir, 'cases');
  mkdirSync(casesDir);
  writeFileSync(join(casesDir, 'w1.json'), caseJson(1));
  writeFileSync(join(casesDir, 'w2.json'), caseJson(2));
  const bedPath = join(dir, 'bed.json');
  writeFileSync(bedPath, JSON.stringify({
    baseUrl: fixture.url,
    users: { user_1: { username: 'user_1', password: 'pass_1' } },
  }));

  const child = spawn('node', [binPath, 'run', casesDir, '--bed', bedPath, '--seed', '7', '--watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const waitFor = (re, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (re.test(out)) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${re}\n--- output so far ---\n${out}`));
      }
    }, 100);
  });

  try {
    await waitFor(/watching .*seed 7 pinned/);
    assert.match(out, /2 pass, 0 fail, 0 error/); // the initial full run

    // change the CONTENT, not just the mtime — an identical rewrite is a fragile trigger,
    // and Windows in particular may coalesce or drop it
    writeFileSync(join(casesDir, 'w1.json'), caseJson(1, 'edited to trigger the watcher'));
    await waitFor(/re-running 1 case file\(s\)/, 30000);
    await waitFor(/1 pass, 0 fail, 0 error/); // scoped: exactly the edited case re-ran
    assert.ok(!out.includes('full re-run'), 'a case edit must not trigger a full re-run');
  } finally {
    child.kill();
    await fixture.close();
  }
});
