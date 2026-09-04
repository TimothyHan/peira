// RFC 0005 amendment (J): a case can send a file. Fixtures are files, small, present; the
// evidence log never carries bytes; the two refusals every upload API has are one case each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCases } from '../dist/runner.js';
import { validateCase } from '../dist/validate.js';
import { renderCase } from '../dist/render.js';
import { MULTIPART_FIXTURE_MAX_BYTES } from '../dist/constants.js';
import { withFixture, makeCase, verdictMeaning } from './helpers.js';

/** A cases directory with three fixture files: a small "png", a big one, and a marker text file. */
function casesDir() {
  const dir = mkdtempSync(join(tmpdir(), 'peira-mp-'));
  mkdirSync(join(dir, 'fixtures'));
  writeFileSync(join(dir, 'fixtures', 'tiny.png'), Buffer.alloc(100, 0x89));
  writeFileSync(join(dir, 'fixtures', 'big.png'), Buffer.alloc(2048, 0x89));
  writeFileSync(join(dir, 'fixtures', 'note.txt'), 'MARKER-BYTES-MUST-NOT-REACH-EVIDENCE-0123456789');
  return dir;
}
const upload = (id, multipart, expect) => makeCase({ id, test: { request: { method: 'post', route: '/upload', auth: '$users.user_1', multipart }, expect } });
const load = (...cases) => cases.map((caseObj) => ({ file: caseObj.id, caseObj }));

test('three upload promises, three declarative cases: accepted 201, wrong type 400, over quota 413', () =>
  withFixture(async ({ url }, bed) => {
    const dir = casesDir();
    const cases = [
      upload('CASE-upload-ok', { fields: { tenant: 't1', _json: { firstName: 'P' } }, files: [{ field: 'file', path: 'fixtures/tiny.png', mimetype: 'image/png' }] },
        { status: 201, body: { by: 'user_1', fields: { tenant: 't1', _json: '{"firstName":"P"}' }, files: [{ field: 'file', filename: 'tiny.png', mimetype: 'image/png', bytes: 100 }] } }),
      upload('CASE-upload-wrong-type', { files: [{ field: 'file', path: 'fixtures/tiny.png', mimetype: 'image/jpeg' }] },
        { status: 400, body: { message: { $contains: 'unsupported type: image/jpeg' } } }),
      upload('CASE-upload-quota', { files: [{ field: 'file', path: 'fixtures/big.png', mimetype: 'image/png' }] },
        { status: 413, body: { message: { $contains: ['quota', 'limit 1024', 'needed 2048'] } } }),
    ];
    for (const c of cases) assert.deepEqual(validateCase(c, { bedUsers: bed.users, baseDir: dir }).errors, [], `${c.id} passes the gate`);
    const { verdicts } = await runCases(load(...cases), { bed, baseUrl: url, seed: 1, baseDir: dir });
    assert.deepEqual(verdictMeaning(verdicts), cases.map((c) => ({ id: c.id, verdict: 'pass' })));
  }));

test('the evidence log records names and sizes, never file content', () =>
  withFixture(async ({ url }, bed) => {
    const dir = casesDir();
    const evidencePath = join(mkdtempSync(join(tmpdir(), 'peira-')), 'evidence.jsonl');
    const c = upload('CASE-upload-evidence', { fields: { note: 'hello' }, files: [{ field: 'file', path: 'fixtures/note.txt', mimetype: 'image/png' }] }, { status: 201 });
    const { counts, events } = await runCases(load(c), { bed, baseUrl: url, seed: 1, baseDir: dir, evidencePath });
    assert.equal(counts.pass, 1);
    const text = readFileSync(evidencePath, 'utf8');
    assert.ok(!text.includes('MARKER-BYTES'), 'fixture content never lands in the evidence log');
    const http = events.find((e) => e.event === 'http');
    assert.equal(http.request.body, undefined, 'no body alongside multipart');
    assert.deepEqual(http.request.multipart, { fields: ['note'], files: [{ field: 'file', filename: 'note.txt', mimetype: 'image/png', bytes: 47 }] });
    assert.ok(!('content-type' in http.request.headers) || !String(http.request.headers['content-type']).includes('json'), 'no JSON content-type on a multipart request');
  }));

test('the gate: fixtures are files, small, present; never beside a body; at least one part', () => {
  const dir = casesDir();
  writeFileSync(join(dir, 'fixtures', 'huge.bin'), Buffer.alloc(MULTIPART_FIXTURE_MAX_BYTES + 1));
  const errs = (multipart, extra = {}) => validateCase(makeCase({ test: { request: { method: 'post', route: '/upload', multipart, ...extra }, expect: { status: 201 } } }), { baseDir: dir }).errors;
  assert.deepEqual(errs({ files: [{ field: 'f', path: 'fixtures/tiny.png' }] }), []);
  assert.match(errs({ files: [{ field: 'f', path: 'fixtures/tiny.png' }] }, { body: { a: 1 } })[0], /mutually exclusive/);
  assert.match(errs({})[0], /at least one of fields \/ files/);
  assert.match(errs({ files: [{ field: 'f', path: 'fixtures/missing.png' }] })[0], /fixture not found/);
  assert.match(errs({ files: [{ field: 'f', path: 'fixtures/huge.bin' }] })[0], /the cap is 262144/);
  assert.match(errs({ files: [{ field: 'f', path: '../etc/passwd' }] })[0], /stay inside it/);
  assert.match(errs({ files: [{ field: 'f', path: '/etc/passwd' }] })[0], /relative to the cases directory/);
  // the schema itself refuses unknown keys and a file without a field
  assert.ok(errs({ files: [{ path: 'fixtures/tiny.png' }] }).length > 0);
  assert.ok(errs({ files: [{ field: 'f', path: 'fixtures/tiny.png', inline: 'bytes' }] }).length > 0);
  // without a baseDir (library caller) the shape is checked and existence is left to the runner
  assert.deepEqual(validateCase(makeCase({ test: { request: { method: 'post', route: '/u', multipart: { files: [{ field: 'f', path: 'nope.png' }] } }, expect: { status: 201 } } })).errors, []);
});

test('a fixture missing at run time is an error, not a fail', () =>
  withFixture(async ({ url }, bed) => {
    const c = upload('CASE-upload-gone', { files: [{ field: 'file', path: 'fixtures/gone.png', mimetype: 'image/png' }] }, { status: 201 });
    const { verdicts } = await runCases(load(c), { bed, baseUrl: url, seed: 1, baseDir: casesDir() });
    assert.equal(verdicts[0].verdict, 'error');
    assert.match(verdicts[0].reason, /fixture fixtures\/gone\.png could not be read/);
  }));

test('render: a multipart request reads as one', () => {
  const md = renderCase(upload('CASE-upload-render', { fields: { a: '1', b: '2' }, files: [{ field: 'file', path: 'fixtures/tiny.png', mimetype: 'image/png' }] }, { status: 201 }));
  assert.match(md, /with multipart \(2 field\(s\), fixtures\/tiny\.png as image\/png\)/);
});
