import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtmlDocument } from '../src/render-html.js';
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
  assert.ok(!/src=|href=|url\(|<script/.test(html), 'self-contained: no external refs, no scripts');
  assert.match(html, /class="badge fail">FAIL<\/span>/);
  assert.match(html, /class="chip drift">triage: drift/);
  assert.match(html, /<del>old &amp; busted<\/del>/);
  assert.match(html, /<ins>new &lt;hotness&gt;<\/ins>/);
  assert.match(html, /expected <code>403<\/code>, got <code>401<\/code>/);
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

test('markdown renderer also weaves triage', async () => {
  const { renderDocument } = await import('../src/render.js');
  const md = renderDocument({ loaded: [{ file: 'x', caseObj: makeCase() }], evidenceText, triageProposals });
  assert.match(md, /\*\*Triage proposes: DRIFT\*\*/);
  assert.match(md, /~~old & busted~~ → \*\*new <hotness>\*\*/);
});
