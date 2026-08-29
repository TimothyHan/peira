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

export interface Stats {
  total: number;
  declarative: number;
  withSteps: number;
  coverage: number;
  steps: Array<{ id: string } & ShapeSignature>;
  recurring: Array<{ skeleton: string; ids: string[]; count: number }>;
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
  };
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
  return lines.join('\n');
}
