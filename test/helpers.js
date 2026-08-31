// Shared test plumbing. Not a test file (does not match *.test.js).

import { test } from 'node:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixtures/server.js';

/**
 * The shared test iterator: one registered test per item, so each fixture/catalog entry
 * reports individually and a failure never masks the items after it.
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => string} nameFor
 * @param {(item: T) => void | Promise<void>} fn
 */
export function testEach(items, nameFor, fn) {
  for (const item of items) test(nameFor(item), () => fn(item));
}

export function makeBed(baseUrl) {
  return {
    baseUrl,
    users: {
      user_1: { username: 'user_1', password: 'pass_1' },
      user_2: { username: 'user_2', password: 'pass_2' },
    },
    drain: {
      route: '/groovy/status',
      idParam: 'id',
      statusPath: 'body.status',
      terminal: ['COMPLETED', 'FAILED'],
    },
  };
}

/** Boot a fixture on an ephemeral port, hand (fixture, bed) to fn, always close. */
export async function withFixture(fn) {
  const fixture = await startFixture();
  try {
    return await fn(fixture, makeBed(fixture.url));
  } finally {
    await fixture.close();
  }
}

/** The RFC §4.2 result-isolation invariant as a template — shared across PR4 suites. */
export function isolationTemplate(over = {}) {
  return {
    id: 'TPL-result-isolation-001',
    from: { intent: 'result-isolation', hash: 'abcdef123456' },
    holes: {
      submitter: { kind: 'principal' },
      other: { kind: 'principal', distinctFrom: 'submitter' },
      script: { kind: 'expression' },
    },
    setup: [{
      request: { method: 'post', route: '/groovy/submit', auth: '$holes.submitter', body: { code: '{{holes.script.code}}' } },
      capture: { requestId: 'body.id' },
    }],
    test: {
      request: { method: 'get', route: '/groovy/status', auth: '$holes.other', query: { id: '$requestId' } },
      expect: { status: 403 },
    },
    ...over,
  };
}

/**
 * Path to the canned `claude` stand-in, in a form the platform can actually execute.
 * POSIX runs the .js directly via its shebang; Windows cannot spawn a .js at all, so we
 * emit a .cmd shim beside it (the same shape npm uses for real CLI binaries).
 */
export function fakeClaudeBin() {
  const js = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.js');
  if (process.platform !== 'win32') {
    chmodSync(js, 0o755);
    return js;
  }
  const cmd = js.replace(/\.js$/, '.cmd');
  writeFileSync(cmd, `@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n`);
  return cmd;
}

/** A verdict list's meaning, without elapsedMs — wall-clock duration is measurement, not verdict. */
export const verdictMeaning = (verdicts) => verdicts.map(({ elapsedMs, ...rest }) => rest);

/** A minimal valid case, override what the test needs. */
export function makeCase(overrides = {}) {
  return {
    id: 'CASE-inline-test',
    from: { intent: 'inline', hash: 'abcdef' },
    test: { request: { method: 'get', route: '/thing' }, expect: { status: 200 } },
    ...overrides,
  };
}
