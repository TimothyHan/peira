// Invariant 9: credential material never lands in plaintext JSONL; hash prefixes keep equality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepRedact, redactValue, EvidenceLog } from '../dist/evidence.js';
import { runCases } from '../dist/runner.js';
import { withFixture, makeCase } from './helpers.js';

test('deepRedact: authorization, cookie, set-cookie at any depth, case-insensitive', () => {
  const redacted = deepRedact({
    a: [{ Authorization: 'Basic abc' }],
    headers: { 'set-cookie': 'session=s3cret', Cookie: 'x=1' },
    keep: 'plain',
  });
  assert.match(redacted.a[0].Authorization, /^\[REDACTED:[0-9a-f]{8}\]$/);
  assert.match(redacted.headers['set-cookie'], /^\[REDACTED:[0-9a-f]{8}\]$/);
  assert.match(redacted.headers.Cookie, /^\[REDACTED:[0-9a-f]{8}\]$/);
  assert.equal(redacted.keep, 'plain');
});

test('equality survives redaction: same value, same tag', () => {
  assert.equal(redactValue('Basic abc'), redactValue('Basic abc'));
  assert.notEqual(redactValue('Basic abc'), redactValue('Basic xyz'));
});

test('a real run writes JSONL with no plaintext credential anywhere — pollUntil retries included', () =>
  withFixture(async ({ url }, bed) => {
    const evidencePath = join(mkdtempSync(join(tmpdir(), 'peira-')), 'evidence.jsonl');
    const caseObj = makeCase({
      setup: [{ request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: 'sleep(1000)' } }, capture: { requestId: 'body.id' } }],
      test: {
        request: { method: 'get', route: '/groovy/status', auth: '$users.user_1', query: { id: '$requestId' } },
        pollUntil: { until: { body: { status: 'COMPLETED' } } },
        expect: { status: 200 },
      },
    });
    const { counts } = await runCases([{ file: 'x', caseObj }], { bed, baseUrl: url, seed: 7, evidencePath });
    assert.equal(counts.pass, 1);

    const lines = readFileSync(evidencePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[0].event, 'run-start');
    assert.equal(lines.at(-1).event, 'run-end');

    const httpEvents = lines.filter((l) => l.event === 'http');
    assert.ok(httpEvents.length >= 3, 'setup + several poll attempts logged');
    const raw = readFileSync(evidencePath, 'utf8');
    assert.ok(!raw.includes('Basic '), 'no plaintext Authorization value in the log');
    assert.ok(!raw.includes(Buffer.from('user_1:pass_1').toString('base64')), 'no base64 credential in the log');
    const tags = new Set(httpEvents.map((e) => e.request.headers.authorization));
    assert.equal(tags.size, 1, 'same credential redacts to the same tag across events');
    assert.match([...tags][0], /^\[REDACTED:[0-9a-f]{8}\]$/);
  }));
