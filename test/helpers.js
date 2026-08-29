// Shared test plumbing. Not a test file (does not match *.test.js).

import { startFixture } from './fixtures/server.js';

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

/** A minimal valid case, override what the test needs. */
export function makeCase(overrides = {}) {
  return {
    id: 'CASE-inline-test',
    from: { intent: 'inline', hash: 'abcdef' },
    test: { request: { method: 'get', route: '/thing' }, expect: { status: 200 } },
    ...overrides,
  };
}
