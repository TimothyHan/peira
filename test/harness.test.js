// The child-process step harness, driven directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness } from '../src/runner.js';
import { startFixture } from './fixtures/server.js';

test('runs generated code with inputs and returns produced values', async () => {
  const result = await runHarness({ code: 'return { out: inputs.a + 1 };', inputs: { a: 41 }, baseUrl: 'http://127.0.0.1:9' });
  assert.deepEqual(result, { ok: true, outputs: { out: 42 } });
});

test('ctx.crypto works; nothing ambient is in scope', async () => {
  const hmac = await runHarness({
    code: "return { sig: ctx.crypto.createHmac('sha256', 'k').update('x').digest('hex'), amb: typeof require };",
    inputs: {},
    baseUrl: 'http://127.0.0.1:9',
  });
  assert.equal(hmac.ok, true);
  assert.match(hmac.outputs.sig, /^[0-9a-f]{64}$/);
  assert.equal(hmac.outputs.amb, 'undefined');
});

test('a non-object return is a contract violation', async () => {
  const result = await runHarness({ code: 'return 42;', inputs: {}, baseUrl: 'http://x' });
  assert.deepEqual({ ok: result.ok, kind: result.kind }, { ok: false, kind: 'contract' });
});

test('a throwing step reports kind=step; an aut network failure reports kind=infra', async () => {
  const thrown = await runHarness({ code: "throw new Error('boom');", inputs: {}, baseUrl: 'http://x' });
  assert.deepEqual({ ok: thrown.ok, kind: thrown.kind }, { ok: false, kind: 'step' });

  const infra = await runHarness({ code: "await ctx.aut({ method: 'get', route: '/x' }); return {};", inputs: {}, baseUrl: 'http://127.0.0.1:9' });
  assert.deepEqual({ ok: infra.ok, kind: infra.kind }, { ok: false, kind: 'infra' });
});

test('ctx.aut reaches the AUT', async () => {
  const fixture = await startFixture();
  try {
    const result = await runHarness({
      code: "const res = await ctx.aut({ method: 'get', route: '/groovy/status', auth: { username: 'user_1', password: 'pass_1' } }); return { status: res.status };",
      inputs: {},
      baseUrl: fixture.url,
    });
    assert.deepEqual(result, { ok: true, outputs: { status: 400 } }); // missing id — but the wire worked
  } finally {
    await fixture.close();
  }
});

test('a hung step is killed at the timeout', async () => {
  // a busy loop truly hangs the child; a bare pending promise just empties its event loop
  // (node exits, and the empty output is reported as a contract failure — also acceptable)
  await assert.rejects(
    () => runHarness({ code: 'for (;;) {}', inputs: {}, baseUrl: 'http://x' }, 500),
    /timed out after 500ms/,
  );
});
