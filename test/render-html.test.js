import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtmlDocument } from '../dist/render-html.js';
import { makeCase } from './helpers.js';

const evidenceText = [
  { event: 'run-start', seed: 7 },
  { event: 'case-start', case: 'CASE-inline-test', definition: makeCase() },
  { event: 'case-verdict', id: 'CASE-inline-test', verdict: 'fail', reason: 'test: assertion failed', diffs: [{ path: 'status', expected: 403, actual: 401, reason: 'status mismatch' }] },
].map((e) => JSON.stringify(e)).join('\n');

const triageProposals = {
  seed: 7,
  verdicts: [{
    case: 'CASE-inline-test',
    classification: 'drift',
    rationale: 'wording only <script>alert(1)</script>',
    intentDiff: { section: 'inline', current: 'old & busted', proposed: 'new <hotness>' },
  }],
};

test('a self-contained page: no external requests, no scripts, badges and triage chips woven in', () => {
  const html = renderHtmlDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText, triageProposals });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.ok(!/src=|url\(|<script|href="(?!#)/.test(html), 'self-contained: no external refs, no scripts; only in-page anchors');
  assert.match(html, /class="badge fail">FAIL<\/span>/);
  assert.match(html, /class="chip drift">triage: drift/);
  assert.match(html, /<del>old &amp; busted<\/del>/);
  assert.match(html, /<ins>new &lt;hotness&gt;<\/ins>/);
  assert.match(html, /expected <code>403<\/code>, got <code>401<\/code>/);
});

test('visual affordances: stat tiles, stacked verdict bar, failure index with anchors, collapsed passes', () => {
  const passing = { ...makeCase({ id: 'CASE-green-001' }) };
  const twoCases = [{ file: 'a', caseObj: makeCase() }, { file: 'b', caseObj: passing }];
  const twoVerdicts = evidenceText + '\n' + [
    { event: 'case-start', case: 'CASE-green-001', definition: passing },
    { event: 'case-verdict', id: 'CASE-green-001', verdict: 'pass' },
  ].map((e) => JSON.stringify(e)).join('\n');
  const html = renderHtmlDocument({ loaded: twoCases, evidenceText: twoVerdicts, triageProposals });
  assert.match(html, /<div class="tile fail"><b>1<\/b>/);
  assert.match(html, /<div class="tile pass"><b>1<\/b>/);
  assert.match(html, /class="seg pass" style="width:50\.0%"/);
  assert.match(html, /Needs attention \(1\)/);
  assert.match(html, /<a href="#CASE-inline-test">/);
  assert.match(html, /<details class="case fail" id="CASE-inline-test" open>/);
  assert.match(html, /<details class="case pass" id="CASE-green-001">/); // passes start collapsed
});

test('untrusted content is escaped — a hostile rationale cannot inject markup', () => {
  const html = renderHtmlDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText, triageProposals });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('without evidence it is a plain test-case document; deterministic output', () => {
  const opts = { loaded: [{ file: 'x', caseObj: makeCase() }] };
  const html = renderHtmlDocument(opts);
  assert.match(html, /<title>Peira test cases<\/title>/);
  assert.equal(html, renderHtmlDocument(opts));
});

test('failing cards carry the observed exchange log; summaries carry timing; hero carries env + categories', async () => {
  const withHttp = [
    { event: 'run-start', seed: 7, baseUrl: 'http://127.0.0.1:9999', cases: 1, minted: 0, version: '0.1.0' },
    { event: 'case-start', case: 'CASE-inline-test', definition: makeCase() },
    { event: 'http', case: 'CASE-inline-test', phase: 'test', attempt: 0, request: { method: 'get', route: '/thing', query: { id: 'x' } }, response: { status: 401, body: { error: 'Unauthorized' }, elapsedMs: 12 } },
    { event: 'http', case: 'CASE-inline-test', phase: 'test', attempt: 1, request: { method: 'get', route: '/thing', query: { id: 'x' } }, response: { status: 401, body: { error: 'Unauthorized' }, elapsedMs: 8 } },
    { event: 'case-verdict', id: 'CASE-inline-test', verdict: 'fail', reason: 'test: assertion failed', diffs: [] },
  ].map((e) => JSON.stringify(e)).join('\n');

  const html = renderHtmlDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText: withHttp, triageProposals });
  assert.match(html, /Observed exchanges \(2\)/);
  assert.match(html, /GET \/thing\?id=x/);
  assert.match(html, /&quot;Unauthorized&quot;/);
  assert.match(html, /<span class="meta">20ms · 2 exchange\(s\)<\/span>/);
  assert.match(html, /bed <code>http:\/\/127\.0\.0\.1:9999<\/code>/);
  assert.match(html, /peira v0\.1\.0/);
  assert.match(html, /<small>pass rate<\/small>/);
  assert.match(html, /class="chip drift">drift 1</);

  const { renderDocument } = await import('../dist/render.js');
  const md = renderDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText: withHttp, triageProposals });
  assert.match(md, /Observed exchanges \(2\)/);
  assert.match(md, /\[test attempt 1\] GET \/thing\?id=x → 401 \(8ms\)/);
  assert.match(md, /· 20ms · 2 exchange\(s\)/);
});

test('markdown renderer also weaves triage', async () => {
  const { renderDocument } = await import('../dist/render.js');
  const md = renderDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText, triageProposals });
  assert.match(md, /\*\*Triage proposes: DRIFT\*\*/);
  assert.match(md, /~~old & busted~~ → \*\*new <hotness>\*\*/);
});
