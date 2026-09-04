// RFC 0004 O5: several Set-Cookie headers used to collapse to the last one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { httpRequest } from '../dist/http.js';
import { matchExpect } from '../dist/expect.js';

test('every Set-Cookie is kept; $contains matches any one of them; other repeated headers still join', async () => {
  const srv = createServer((req, res) => {
    res.setHeader('set-cookie', ['a=1; Path=/', 'payload-token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'c=3']);
    res.setHeader('x-multi', ['one', 'two']);
    res.end('ok');
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  try {
    const res = await httpRequest({ baseUrl: `http://127.0.0.1:${srv.address().port}`, method: 'get', route: '/' });
    assert.ok(res.headers['set-cookie'].includes('a=1'), 'first cookie kept');
    assert.ok(res.headers['set-cookie'].includes('payload-token=;'), 'middle cookie kept — the one the report asserts on');
    assert.ok(res.headers['set-cookie'].includes('c=3'));
    assert.equal(res.headers['x-multi'], 'one, two');
    assert.deepEqual(matchExpect({ headers: { 'set-cookie': { $contains: ['payload-token=;', 'a=1'] } } }, res), []);
  } finally {
    // node 18: destroy the client's idle keep-alive socket, or close() holds the process ~5 s
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});
