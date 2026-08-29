import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateAdoptedDocument, adoptDocument, buildAdoptPrompt } from '../src/adopt.js';
import { lintIntent, parseIntent } from '../src/intent.js';

const SOURCE = `Requirements

- Users can create an order with a valid payment method
- An order for an out-of-stock item is rejected
`;

const GOOD = `# Requirements

## Create an order
<!-- peira: id=order-create kind=ac -->
Users can create an order with a valid payment method

## Out-of-stock rejection
<!-- peira: id=order-out-of-stock kind=ac -->
An order for an out-of-stock item is rejected
`;

test('a well-formed proposal passes the gate with a full-preservation report', () => {
  const { sections, report, errors } = gateAdoptedDocument(GOOD, SOURCE);
  assert.deepEqual(errors, []);
  assert.deepEqual(sections.map((s) => s.id), ['order-create', 'order-out-of-stock']);
  assert.ok(sections.every((s) => s.tagged));
  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
  assert.equal(report.kept, report.sourceLines);
});

test('untagged sections are refused — derived ids are fragile lineage', () => {
  const untagged = GOOD.replace('<!-- peira: id=order-create kind=ac -->\n', '');
  const { errors } = gateAdoptedDocument(untagged, SOURCE);
  assert.ok(errors.some((e) => /without a peira tag.*order-create|create-an-order/.test(e)), String(errors));
});

test('dropped source content is named in the report, not silently lost', () => {
  const lossy = GOOD.replace('An order for an out-of-stock item is rejected', 'Something else entirely');
  const { report, errors } = gateAdoptedDocument(lossy, SOURCE);
  assert.deepEqual(errors, []);
  assert.deepEqual(report.dropped, ['an order for an out-of-stock item is rejected']);
});

test('prose, empty output, and duplicate tagged ids are refused', () => {
  assert.ok(gateAdoptedDocument('Sure! Here is a plan…', SOURCE).errors.length > 0);
  const dup = GOOD.replaceAll('id=order-out-of-stock', 'id=order-create');
  assert.ok(gateAdoptedDocument(dup, SOURCE).errors.some((e) => /does not parse: .*duplicate/.test(e)));
});

test('fenced model output is unwrapped; adoptDocument threads the transport', async () => {
  const { errors, report } = await adoptDocument({ sourceText: SOURCE, llm: async (prompt) => {
    assert.match(prompt, /RESTRUCTURE, DO NOT REWRITE/);
    return '```markdown\n' + GOOD + '\n```';
  } });
  assert.deepEqual(errors, []);
  assert.equal(report.sections, 2);
});

test('the prompt embeds the source verbatim', () => {
  assert.ok(buildAdoptPrompt(SOURCE).includes('out-of-stock item'));
});

test('intent lint: oversized sections and derived slug collisions warn, tags silence the collision', () => {
  const big = '## Huge\n\n' + Array.from({ length: 45 }, (_, i) => `- line ${i}`).join('\n') + '\n';
  assert.match(lintIntent(parseIntent(big))[0], /45 content lines/);

  const colliding = parseIntent('## Security\n\na\n\n## Security\n\nb\n');
  assert.ok(lintIntent(colliding).some((w) => /derived slug collision/.test(w)));

  const tagged = parseIntent('## Security\n<!-- peira: id=security -->\na\n\n## Security\n<!-- peira: id=security-2 -->\nb\n');
  assert.deepEqual(lintIntent(tagged), []);
});
