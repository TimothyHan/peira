// Fallback telemetry (RFC 0001 §4.6), derived from the artifacts themselves — cases and step
// definitions ARE the escape record, so there is no side-log to drift out of sync.
// `peira stats` reports DSL coverage (the suite's health headline) and recurring fallback
// shapes (the compiler telling you which primitive the DSL is missing, with evidence).

import { createHash } from 'node:crypto';
import type { LoadedCase, StepDef } from './types.js';

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'false', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'let', 'new',
  'null', 'of', 'return', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
  'var', 'void', 'while', 'yield',
]);

/** Structural skeleton of step code: literals and identifiers normalized, keywords kept. */
export function codeSkeleton(code: string): string {
  const normalized = code
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, 'S')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (word) => (JS_KEYWORDS.has(word) ? word : 'I'))
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

export interface ShapeSignature {
  reads: string[];
  produces: string[];
  skeleton: string;
}

export function shapeSignature(stepDef: StepDef): ShapeSignature {
  return {
    reads: [...stepDef.reads].sort(),
    produces: [...stepDef.produces].sort(),
    skeleton: codeSkeleton(stepDef.code),
  };
}

/** One row of the refusal balance (RFC 0005 P1). Classification is static, from test.expect. */
export interface BalanceRow {
  intent: string;
  cases: number;
  /** test.expect.status < 400 */
  positive: number;
  /** test.expect.status >= 400 */
  negative: number;
  /** the test's expect contains $absent or $notContains — a denial inside any status */
  negativeOracle: number;
  /** no test.expect.status (pollUntil-only) */
  unclassified: number;
}

export interface Stats {
  total: number;
  declarative: number;
  withSteps: number;
  coverage: number;
  steps: Array<{ id: string } & ShapeSignature>;
  recurring: Array<{ skeleton: string; ids: string[]; count: number }>;
  /** per intent, sorted by intent id, plus a total row; intents with only positives are the review flag */
  balance: { intents: BalanceRow[]; total: BalanceRow; positiveOnly: string[] };
}

const NEGATIVE_ORACLE = /"\$(absent|notContains)"/;

/** Refusals are where multi-tenant and auth bugs live; a suite drifts positive one happy path at a time. */
export function computeBalance(loaded: LoadedCase[]): Stats['balance'] {
  const rows = new Map<string, BalanceRow>();
  const blank = (intent: string): BalanceRow => ({ intent, cases: 0, positive: 0, negative: 0, negativeOracle: 0, unclassified: 0 });
  const total = blank('total');
  for (const { caseObj } of loaded) {
    const intent = caseObj?.from?.intent ?? '(unbound)';
    const row = rows.get(intent) ?? blank(intent);
    rows.set(intent, row);
    const test = (caseObj?.test ?? {}) as { expect?: { status?: unknown } };
    const status = test.expect?.status;
    const negOracle = NEGATIVE_ORACLE.test(JSON.stringify(test.expect ?? {}));
    for (const r of [row, total]) {
      r.cases += 1;
      if (typeof status !== 'number') r.unclassified += 1;
      else if (status >= 400) r.negative += 1;
      else r.positive += 1;
      if (negOracle) r.negativeOracle += 1;
    }
  }
  const intents = [...rows.values()].sort((a, b) => a.intent.localeCompare(b.intent));
  const positiveOnly = intents.filter((r) => r.positive > 0 && r.negative === 0 && r.negativeOracle === 0).map((r) => r.intent);
  return { intents, total, positiveOnly };
}

export function computeStats(loaded: LoadedCase[], steps: Map<string, StepDef>): Stats {
  const usesStep = (caseObj: LoadedCase['caseObj']) => (caseObj.setup ?? []).some((s) => 'step' in s);
  const withSteps = loaded.filter(({ caseObj }) => usesStep(caseObj));
  const total = loaded.length;

  const stepReport = [...steps.values()].map((def) => ({ id: def.id, ...shapeSignature(def) }));
  const bySkeleton = new Map<string, string[]>();
  for (const s of stepReport) {
    if (!bySkeleton.has(s.skeleton)) bySkeleton.set(s.skeleton, []);
    bySkeleton.get(s.skeleton)!.push(s.id);
  }
  const recurring = [...bySkeleton.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([skeleton, ids]) => ({ skeleton, ids, count: ids.length }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    declarative: total - withSteps.length,
    withSteps: withSteps.length,
    coverage: total === 0 ? 1 : (total - withSteps.length) / total,
    steps: stepReport,
    recurring,
    balance: computeBalance(loaded),
  };
}

/** The balance as an aligned table; the unclassified column appears only when it is non-zero. */
export function formatBalance(balance: Stats['balance']): string {
  const showUnclassified = balance.total.unclassified > 0;
  const cols: Array<[string, (r: BalanceRow) => string]> = [
    ['intent', (r) => r.intent],
    ['cases', (r) => String(r.cases)],
    ['positive', (r) => String(r.positive)],
    ['negative', (r) => String(r.negative)],
    ['negative-oracle', (r) => String(r.negativeOracle)],
    ...(showUnclassified ? ([['unclassified', (r: BalanceRow) => String(r.unclassified)]] as Array<[string, (r: BalanceRow) => string]>) : []),
  ];
  const rows = [...balance.intents, balance.total];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => f(r).length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  const out = ['refusal balance (positive: expected status < 400 · negative: >= 400 · negative-oracle: $absent or $notContains in the test):'];
  out.push('  ' + line(cols.map(([h]) => h)));
  for (const r of rows) out.push('  ' + line(cols.map(([, f]) => f(r))));
  if (balance.positiveOnly.length > 0) {
    out.push(`  ${balance.positiveOnly.length} intent(s) test only the happy path: ${balance.positiveOnly.join(', ')}`);
  }
  return out.join('\n');
}

export function formatStats(stats: Stats): string {
  const lines: string[] = [];
  lines.push(`cases: ${stats.total} | fully declarative: ${stats.declarative} | using steps: ${stats.withSteps}`);
  lines.push(`DSL coverage: ${(stats.coverage * 100).toFixed(1)}%`);
  if (stats.steps.length > 0) {
    lines.push('');
    lines.push('escape-hatch steps:');
    for (const s of stats.steps) {
      lines.push(`  ${s.id}  reads:[${s.reads.join(',')}] produces:[${s.produces.join(',')}] shape:${s.skeleton}`);
    }
  }
  if (stats.recurring.length > 0) {
    lines.push('');
    lines.push('recurring fallback shapes (the DSL asking for a primitive, with evidence):');
    for (const g of stats.recurring) {
      lines.push(`  shape ${g.skeleton} x${g.count}: ${g.ids.join(', ')}`);
    }
  }
  if (stats.total > 0) {
    lines.push('');
    lines.push(formatBalance(stats.balance));
  }
  return lines.join('\n');
}
