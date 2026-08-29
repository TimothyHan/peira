import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from './fixtures/plants.js';
import { startFixture } from './fixtures/server.js';
import { httpRequest } from '../src/http.js';

const alice = { username: 'user_1', password: 'pass_1' };

async function withPlant(plant, fn) {
  const fixture = await startFixture({ plant });
  try {
    return await fn(fixture.url);
  } finally {
    await fixture.close();
  }
}

test('the catalog is pre-registered: ≥30 shifts, valid truths, unique descriptions', () => {
  const entries = Object.entries(PLANTS);
  assert.ok(entries.length >= 30, `${entries.length} shifts`);
  for (const [id, p] of entries) {
    assert.ok(['bug', 'drift', 'flake'].includes(p.truth), id);
    assert.ok(p.desc.length > 10, id);
    assert.ok(p.flags && typeof p.flags === 'object', id);
  }
  const truths = entries.reduce((acc, [, p]) => ((acc[p.truth] = (acc[p.truth] ?? 0) + 1), acc), {});
  assert.ok(truths.bug >= 15 && truths.drift >= 5 && truths.flake >= 3, JSON.stringify(truths));
});

test('no plant = the unplanted fixture (spot probes)', () =>
  withPlant(null, async (url) => {
    const submit = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    assert.equal(submit.status, 200);
    const bad = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: {} });
    assert.deepEqual({ status: bad.status, message: bad.body.message }, { status: 400, message: '' });
  }));

test('representative bug plants shift behavior as declared', async () => {
  await withPlant('submit-500', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    assert.equal(res.status, 500);
  });
  await withPlant('auth-accept-any', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: { username: 'user_1', password: 'WRONG' }, body: { code: '1+1' } });
    assert.equal(res.status, 200);
  });
  await withPlant('submit-id-renamed', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    assert.ok(!('id' in res.body) && 'requestId' in res.body);
  });
  await withPlant('accepts-empty-body', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: {} });
    assert.equal(res.status, 200);
  });
});

test('representative drift plants change only what the intent never pinned', async () => {
  await withPlant('validation-message-text', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: {} });
    assert.deepEqual({ status: res.status, message: res.body.message }, { status: 400, message: 'Validation failed: request rejected' });
  });
  await withPlant('timestamp-numeric', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: {} });
    assert.equal(typeof res.body.timestamp, 'number');
  });
  await withPlant('envelope-drops-path', async (url) => {
    const res = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: {} });
    assert.ok(!('path' in res.body));
  });
});

test('flake plants: boot transient recovers; every-3rd fires on schedule', async () => {
  await withPlant('fail-first-2', async (url) => {
    const first = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    const second = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    const third = await httpRequest({ baseUrl: url, method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1+1' } });
    assert.deepEqual([first.status, second.status, third.status], [500, 500, 200]);
  });
  await withPlant('fail-every-3rd-status', async (url) => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await httpRequest({ baseUrl: url, method: 'get', route: '/groovy/status', query: { id: 'invalidRequestID' }, auth: alice });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [400, 400, 500, 400, 400, 500]);
  });
});

test('an unknown plant id refuses to boot', () => {
  assert.throws(() => startFixture({ plant: 'no-such-shift' }), /unknown plant/);
});
