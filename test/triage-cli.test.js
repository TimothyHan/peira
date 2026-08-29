// End-to-end with a canned model: real run evidence in, gated proposals file out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCases } from '../dist/runner.js';
import { EvidenceLog } from '../dist/evidence.js';
import { withFixture, makeCase } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(here, 'fixtures', 'fake-claude.js');
const binPath = join(here, '..', 'bin', 'peira.js');

test('peira triage: evidence in → schema-gated proposals out; drift diff names the section', () =>
  withFixture(async ({ url }, bed) => {
    chmodSync(fakeBin, 0o755);
    const dir = mkdtempSync(join(tmpdir(), 'peira-triage-'));
    const evidencePath = join(dir, 'run.jsonl');
    const intentDir = join(dir, 'intent');
    mkdirSync(intentDir);
    writeFileSync(join(intentDir, 'plan.md'), '## Submit works\n\nSubmitting a valid script is accepted (the service signals acceptance).\n');

    const failing = makeCase({
      id: 'CASE-submit-works-001',
      from: { intent: 'submit-works', hash: 'abcdef123456' },
      test: { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, expect: { status: 418 } },
    });
    await runCases([{ file: 'x', caseObj: failing }], { bed, baseUrl: url, seed: 1, evidencePath });

    const canned = {
      verdicts: [{
        case: 'CASE-submit-works-001',
        classification: 'drift',
        rationale: 'the case over-specifies the status code; the intent only demands acceptance',
        intentDiff: { section: 'submit-works', current: 'accepted', proposed: 'accepted (HTTP 200)' },
      }],
    };
    const { stdout } = await promisify(execFile)(process.execPath, [binPath, 'triage', '--evidence', evidencePath, '--intent', intentDir], {
      env: { ...process.env, PEIRA_CLAUDE_BIN: fakeBin, FAKE_CLAUDE_OUTPUT: JSON.stringify(canned) },
    });
    assert.match(stdout, /DRIFT CASE-submit-works-001/);
    assert.match(stdout, /nothing applied/);

    const proposals = JSON.parse(readFileSync(join(dir, 'run-triage.json'), 'utf8'));
    assert.equal(proposals.verdicts[0].intentDiff.section, 'submit-works');
    assert.deepEqual({ refused: proposals.refused, uncovered: proposals.uncovered }, { refused: [], uncovered: [] });
  }));

test('a passing run writes proposals without ever spawning the model', () =>
  withFixture(async ({ url }, bed) => {
    const dir = mkdtempSync(join(tmpdir(), 'peira-triage-'));
    const evidencePath = join(dir, 'run.jsonl');
    const intentDir = join(dir, 'intent');
    mkdirSync(intentDir);
    writeFileSync(join(intentDir, 'plan.md'), '## Anything\n\ntext\n');
    const passing = makeCase({
      id: 'CASE-passes-001',
      test: { request: { method: 'post', route: '/groovy/submit', auth: '$users.user_1', body: { code: '1+1' } }, expect: { status: 200 } },
    });
    await runCases([{ file: 'x', caseObj: passing }], { bed, baseUrl: url, seed: 1, evidencePath });

    const { stdout } = await promisify(execFile)(process.execPath, [binPath, 'triage', '--evidence', evidencePath, '--intent', intentDir], {
      env: { ...process.env, PEIRA_CLAUDE_BIN: '/nonexistent-must-never-spawn' },
    });
    assert.match(stdout, /no failures to triage — nothing was sent/);
  }));
