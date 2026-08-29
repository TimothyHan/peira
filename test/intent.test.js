import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIntent, loadIntentDir, hashSection, normalizeText } from '../src/intent.js';

const here = dirname(fileURLToPath(import.meta.url));

test('tagged sections read id and kind from the peira tag', () => {
  const md = `## Result isolation
<!-- peira: id=result-isolation kind=invariant -->
Results are visible only to the submitter.
`;
  const [s] = parseIntent(md);
  assert.equal(s.id, 'result-isolation');
  assert.equal(s.kind, 'invariant');
});

test('derive mode: untagged headings slug their title, kind defaults to ac', () => {
  const [s] = parseIntent('## Submit returns an id\n\nA valid submission returns the id.\n');
  assert.deepEqual({ id: s.id, kind: s.kind }, { id: 'submit-returns-an-id', kind: 'ac' });
});

test('flat segmentation: each heading owns only its direct body; containers vanish', () => {
  const md = `## Container

### Real one

body text

### Another

more text
`;
  const sections = parseIntent(md);
  assert.deepEqual(sections.map((s) => s.id), ['real-one', 'another']);
  assert.equal(sections[0].text.includes('more text'), false);
});

test('duplicate derived slugs uniquify deterministically; duplicate tagged ids throw', () => {
  const sections = parseIntent('## Security\n\na\n\n## Security\n\nb\n');
  assert.deepEqual(sections.map((s) => s.id), ['security', 'security-2']);
  assert.throws(() => parseIntent('## A\n<!-- peira: id=x -->\na\n\n## B\n<!-- peira: id=x -->\nb\n'), /duplicate intent id/);
});

test('hash contract: LF-normalized, trailing whitespace stripped, stable', () => {
  assert.equal(hashSection('a  \r\nb\n\n'), hashSection('a\nb'));
  assert.notEqual(hashSection('a'), hashSection('b'));
  assert.equal(normalizeText('\n\nx  \n\n'), 'x');
  assert.match(hashSection('x'), /^[0-9a-f]{12}$/);
});

test('the verbatim 2022 test plan ingests with zero edits into the expected section set', () => {
  const all = loadIntentDir(join(here, '..', 'intent'));
  const sections = all.filter((s) => s.file === '2022-test-plan.md');
  const ids = sections.map((s) => s.id);
  assert.equal(sections.length, 16, JSON.stringify(ids));
  assert.ok(all.some((s) => s.id === 'hmac-echo' && s.kind === 'ac'), 'the PR3 demo intent is present');
  // the AC sections the fidelity experiment compiles
  for (const expected of ['security-2', 'post-groovy-submit', 'get-groovy-status', 'robustness-2', 'parallel-execution-and-request-queueing-2']) {
    assert.ok(ids.includes(expected), `missing ${expected} in ${JSON.stringify(ids)}`);
  }
  // "## Acceptance Criteria" is a pure container — it must NOT be a section
  assert.ok(!ids.includes('acceptance-criteria'));
  // the registered divergences are inside the ingested text
  const security = sections.find((s) => s.id === 'security-2');
  assert.match(security.text, /1\.4.*403 Forbidden/);
  const status = sections.find((s) => s.id === 'get-groovy-status');
  assert.match(status.text, /3\.6.*404 Not found/);
  for (const s of sections) assert.equal(s.kind, 'ac');
});

