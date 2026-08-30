import { test } from 'node:test';
import assert from 'node:assert/strict';
import { junitXml } from '../dist/report-junit.js';

const result = {
  seed: 42,
  counts: { pass: 1, fail: 1, error: 1 },
  verdicts: [
    { id: 'CASE-ok', verdict: 'pass', elapsedMs: 120 },
    {
      id: 'CASE-broken', verdict: 'fail', reason: 'test: assertion failed', elapsedMs: 40,
      diffs: [{ path: 'status', expected: 409, actual: 200, reason: 'status mismatch' }],
    },
    { id: 'CASE-down', verdict: 'error', reason: 'GET http://x: ECONNREFUSED', elapsedMs: 5 },
  ],
  events: [],
};

test('verdict taxonomy maps losslessly: pass/fail/error → testcase/failure/error', () => {
  const xml = junitXml(result);
  assert.match(xml, /<testsuite name="peira" tests="3" failures="1" errors="1"/);
  assert.match(xml, /<testcase classname="peira" name="CASE-ok" time="0.120"\/>/);
  assert.match(xml, /<failure message="test: assertion failed">/);
  assert.match(xml, /status: expected 409, got 200 \(status mismatch\)/);
  assert.match(xml, /<error message="GET http:\/\/x: ECONNREFUSED">/);
  assert.match(xml, /<property name="seed" value="42"\/>/);
});

test('XML special characters in reasons and diffs are escaped', () => {
  const xml = junitXml({
    seed: 1,
    counts: { pass: 0, fail: 1, error: 0 },
    verdicts: [{
      id: 'CASE-esc', verdict: 'fail', reason: 'expected <b> & "quotes"',
      diffs: [{ path: 'body.msg', expected: '<tag>', actual: '&amp;', reason: 'value mismatch' }],
    }],
    events: [],
  });
  assert.match(xml, /expected &lt;b&gt; &amp; &quot;quotes&quot;/);
  assert.ok(!/<b>/.test(xml));
});

test('a suite name is escaped and a missing elapsedMs renders as zero time', () => {
  const xml = junitXml(
    { seed: 1, counts: { pass: 1, fail: 0, error: 0 }, verdicts: [{ id: 'CASE-x', verdict: 'pass' }], events: [] },
    { suiteName: 'orders & billing' },
  );
  assert.match(xml, /<testsuite name="orders &amp; billing"/);
  assert.match(xml, /time="0.000"\/>/);
});
