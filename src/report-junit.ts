// JUnit XML report for CI pipelines (`peira run --junit <path>`). One-way generated output,
// like `render`: never parsed back, never a source of truth. The verdict taxonomy maps onto
// JUnit's without loss — pass → <testcase/>, fail → <failure> (an assertion did not hold),
// error → <error> (infrastructure failed before an assertion could).

import type { RunResult, Verdict } from './types.js';

const esc = (v: unknown): string =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters even escaped — strip them
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function detail(v: Verdict): string {
  const lines = [v.reason ?? ''];
  for (const d of v.diffs ?? []) {
    lines.push(`${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)} (${d.reason})`);
  }
  return lines.filter(Boolean).join('\n');
}

const secs = (ms: number | undefined): string => ((ms ?? 0) / 1000).toFixed(3);

/** Render a run result as a JUnit XML document. */
export function junitXml(result: RunResult, { suiteName = 'peira' }: { suiteName?: string } = {}): string {
  const { verdicts, counts, seed } = result;
  const totalMs = verdicts.reduce((sum, v) => sum + (v.elapsedMs ?? 0), 0);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="${esc(suiteName)}" tests="${verdicts.length}" failures="${counts.fail}" errors="${counts.error}" time="${secs(totalMs)}">`,
  );
  lines.push(
    `  <testsuite name="${esc(suiteName)}" tests="${verdicts.length}" failures="${counts.fail}" errors="${counts.error}" time="${secs(totalMs)}">`,
  );
  lines.push(`    <properties><property name="seed" value="${seed}"/></properties>`);
  for (const v of verdicts) {
    const open = `    <testcase classname="${esc(suiteName)}" name="${esc(v.id)}" time="${secs(v.elapsedMs)}"`;
    if (v.verdict === 'pass') {
      lines.push(`${open}/>`);
      continue;
    }
    const tag = v.verdict === 'fail' ? 'failure' : 'error';
    lines.push(`${open}>`);
    lines.push(`      <${tag} message="${esc(v.reason ?? v.verdict)}">${esc(detail(v))}</${tag}>`);
    lines.push('    </testcase>');
  }
  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return lines.join('\n') + '\n';
}
