// `peira render` — deterministic, zero-LLM rendering of case artifacts into readable markdown.
// STRICTLY ONE-WAY: the output is generated documentation, never parsed back, never edited,
// never a source of truth (invariant 2). Regenerate it like `stats`; do not commit it.

import { parseEvidence, type TriageProposals, type TriageVerdict, type EvidenceEvent } from './triage.js';
import type { Case, LoadedCase, StepDef, Template, Verdict, VerdictCounts } from './types.js';
import type { IntentSection } from './intent.js';

const cap = (text: string, n = 140): string => (text.length > n ? text.slice(0, n) + ' …' : text);

/** Replace matcher objects with readable tokens, then compact-stringify. */
function fmtExpected(expected: unknown): string {
  const walk = (node: any): any => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if ('$any' in node && Object.keys(node).length === 1) return `<any ${node.$any}>`;
      if ('$contains' in node && Object.keys(node).length === 1) return `<contains ${JSON.stringify(node.$contains)}>`;
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    if (Array.isArray(node)) return node.map(walk);
    return node;
  };
  return cap(JSON.stringify(walk(expected)));
}

function fmtAuth(auth: any): string {
  if (auth === undefined) return 'anonymously';
  if (typeof auth === 'string') return `as ${auth.slice('$users.'.length)}`;
  if ('token' in auth) return 'with an explicit token'; // amendment (F): the value never renders
  return `with credentials "${auth.username}" / "${auth.password}"`;
}

function fmtRequest(req: any): string {
  const query = req.query ? '?' + Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join('&') : '';
  const body = req.body !== undefined ? ` with body ${cap(JSON.stringify(req.body))}` : '';
  return `${req.method.toUpperCase()} ${req.route}${query} ${fmtAuth(req.auth)}${body}`;
}

function fmtExpectPhrase(expect: any): string {
  const parts: string[] = [];
  if ('status' in expect) parts.push(`the response is ${expect.status}`);
  if ('headers' in expect) parts.push(`the headers match ${fmtExpected(expect.headers)}`);
  if ('body' in expect) parts.push(`the body matches ${fmtExpected(expect.body)}`);
  if ('bodySchema' in expect) parts.push(`the body satisfies the schema ${cap(JSON.stringify(expect.bodySchema), 100)}`);
  return parts.join(', and ') || 'nothing is asserted';
}

function renderStepLine(step: any, steps: Map<string, StepDef> | undefined): string {
  if ('step' in step) {
    const def = steps?.get(step.step);
    const contract = def ? ` (reads ${def.reads.join(', ') || '—'} → produces ${def.produces.join(', ')})` : '';
    const bind = step.bind ? ` binding ${cap(JSON.stringify(step.bind), 100)}` : '';
    return `runs generated procedure ${step.step}${contract}${bind}`;
  }
  const capture = step.capture
    ? `   (captures ${Object.entries(step.capture).map(([alias, path]) => `${alias} ← ${path}`).join(', ')})`
    : '';
  const poll = step.pollUntil
    ? `\n         polling until ${fmtExpectPhrase(step.pollUntil.until)}${step.pollUntil.timeoutMs ? ` (timeout ${step.pollUntil.timeoutMs}ms)` : ''}`
    : '';
  return `${fmtRequest(step.request)}${capture}${poll}`;
}

export interface RenderCaseOptions {
  steps?: Map<string, StepDef>;
  verdict?: Verdict;
  triage?: TriageVerdict;
  exchanges?: EvidenceEvent[];
  durationMs?: number;
}

/** Render one case as Given/When/Then lines. */
export function renderCase(caseObj: Case, { steps, verdict, triage, exchanges, durationMs }: RenderCaseOptions = {}): string {
  const lines: string[] = [];
  const icon = verdict ? { pass: '✅', fail: '❌', error: '🟡' }[verdict.verdict] + ' ' : '';
  const timing = durationMs ? ` · ${durationMs}ms${exchanges ? ` · ${exchanges.length} exchange(s)` : ''}` : '';
  lines.push(`### ${icon}${caseObj.id}${caseObj.title ? ` — ${caseObj.title}` : ''}${timing}`);
  if (caseObj.notes) lines.push(`> ${caseObj.notes}`);
  lines.push('');
  for (const [i, step] of (caseObj.setup ?? []).entries()) {
    lines.push(`- **${i === 0 ? 'Given' : 'And'}**  ${renderStepLine(step, steps)}`);
  }
  const test = caseObj.test as any;
  lines.push(`- **When**   ${renderStepLine({ ...test, expect: undefined }, steps)}`);
  if (test.expect) lines.push(`- **Then**   ${fmtExpectPhrase(test.expect)}`);
  if (caseObj.teardown?.drain) lines.push(`- **Finally** every captured job is drained to a terminal state`);
  const from = caseObj.from;
  const minted = from.template !== undefined ? ` (minted from ${from.template}, seed ${from.seed}, instance ${from.instance})` : '';
  lines.push(`- *From intent \`${from.intent}\` @ \`${from.hash}\`${minted}*`);
  if (verdict && verdict.verdict !== 'pass') {
    lines.push(`- **Verdict: ${verdict.verdict.toUpperCase()}** — ${verdict.reason ?? ''}`);
    for (const d of verdict.diffs ?? []) {
      lines.push(`  - at \`${d.path}\`: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)} (${d.reason})`);
    }
  }
  if (verdict && verdict.verdict !== 'pass' && exchanges?.length) {
    lines.push(`- **Observed exchanges (${exchanges.length})** — the debugging log, bodies redacted at capture:`);
    for (const e of exchanges) lines.push(`  - ${fmtExchange(e)}`);
  }
  if (triage) lines.push(...triageLines(triage));
  return lines.join('\n');
}

function renderTemplate(tpl: Template, perRun: number): string {
  const lines: string[] = [];
  lines.push(`### ${tpl.id}${tpl.title ? ` — ${tpl.title}` : ''}`);
  lines.push('');
  const holes = Object.entries(tpl.holes).map(([name, decl]: [string, any]) =>
    `\`${name}\`: ${decl.kind}${decl.distinctFrom ? ` (distinct from \`${decl.distinctFrom}\`)` : ''}`,
  );
  lines.push(`- **For any** ${holes.join('; ')} — mints ${perRun} seeded instances per run`);
  for (const [i, step] of ((tpl.setup ?? []) as any[]).entries()) {
    lines.push(`- **${i === 0 ? 'Given' : 'And'}**  ${renderStepLine(step, undefined)}`);
  }
  lines.push(`- **When**   ${renderStepLine({ ...(tpl.test as any), expect: undefined }, undefined)}`);
  if ((tpl.test as any).expect) lines.push(`- **Then**   ${fmtExpectPhrase((tpl.test as any).expect)}`);
  lines.push(`- *From intent \`${tpl.from.intent}\` @ \`${tpl.from.hash}\`*`);
  return lines.join('\n');
}

export interface RunHeader {
  seed: number | null;
  counts: VerdictCounts;
  baseUrl?: string;
  version?: string;
  minted: number;
}

export interface ReportModel {
  runHeader: RunHeader | null;
  verdictFor: Map<string, Verdict>;
  triageFor: Map<string, TriageVerdict>;
  mintedCases: Case[];
  groups: Map<string, Case[]>;
  sectionFor: Map<string, IntentSection>;
  exchangesFor: Map<string, EvidenceEvent[]>;
  durationFor: Map<string, number>;
}

export interface ReportInputs {
  loaded: LoadedCase[];
  sections?: IntentSection[] | null;
  evidenceText?: string | null;
  triageProposals?: TriageProposals | null;
}

/** Extract the shared report model consumed by the markdown and HTML renderers. */
export function buildReportModel({ loaded, sections, evidenceText, triageProposals }: ReportInputs): ReportModel {
  const verdictFor = new Map<string, Verdict>();
  const triageFor = new Map<string, TriageVerdict>();
  const exchangesFor = new Map<string, EvidenceEvent[]>();
  const durationFor = new Map<string, number>();
  let mintedCases: Case[] = [];
  let runHeader: RunHeader | null = null;

  if (evidenceText) {
    const parsed = parseEvidence(evidenceText);
    for (const v of parsed.verdicts) verdictFor.set(v.id, v);
    const counts: VerdictCounts = { pass: 0, fail: 0, error: 0 };
    for (const v of parsed.verdicts) counts[v.verdict] += 1;
    runHeader = {
      seed: parsed.seed,
      counts,
      baseUrl: parsed.runStart?.baseUrl,
      version: parsed.runStart?.version,
      minted: parsed.runStart?.minted ?? 0,
    };
    mintedCases = [...parsed.definitions.values()].filter((d) => d?.from?.template !== undefined);
    for (const [caseId, events] of parsed.httpByCase) {
      exchangesFor.set(caseId, events);
      durationFor.set(caseId, events.reduce((ms, e) => ms + (e.response?.elapsedMs ?? 0), 0));
    }
    for (const [caseId, events] of parsed.stepsByCase) {
      durationFor.set(caseId, (durationFor.get(caseId) ?? 0) + events.reduce((ms, e) => ms + (e.elapsedMs ?? 0), 0));
    }
  }
  for (const v of triageProposals?.verdicts ?? []) triageFor.set(v.case, v);

  const sectionFor = new Map((sections ?? []).map((s) => [s.id, s]));
  const groups = new Map<string, Case[]>();
  for (const { caseObj } of loaded) {
    const key = caseObj.from?.intent ?? '(no lineage)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(caseObj);
  }
  return { runHeader, verdictFor, triageFor, mintedCases, groups, sectionFor, exchangesFor, durationFor };
}

/** Compact one-line rendering of an observed HTTP exchange (bodies already redacted at write time). */
export function fmtExchange(e: EvidenceEvent, capBody = 200): string {
  const query = e.request.query ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(e.request.query).map(([k, v]) => [k, String(v)]))).toString() : '';
  const sent = e.request.body !== undefined ? ` sent ${cap(JSON.stringify(e.request.body), capBody)}` : '';
  const got = ` → ${e.response.status} (${e.response.elapsedMs}ms) body ${cap(JSON.stringify(e.response.body), capBody)}`;
  return `[${e.phase} attempt ${e.attempt}] ${e.request.method.toUpperCase()} ${e.request.route}${query}${sent}${got}`;
}

/** Render a triage adjudication as markdown lines. */
function triageLines(triage: TriageVerdict): string[] {
  const lines: string[] = [`- **Triage proposes: ${triage.classification.toUpperCase()}** — ${triage.rationale}`];
  if (triage.intentDiff) {
    lines.push(`  - proposed intent diff for \`${triage.intentDiff.section}\`: ~~${triage.intentDiff.current}~~ → **${triage.intentDiff.proposed}**`);
  }
  if (triage.finding) lines.push(`  - finding: ${triage.finding.title} (expected ${triage.finding.expected}, actual ${triage.finding.actual})`);
  if (triage.prescription) lines.push(`  - prescription: ${triage.prescription}`);
  return lines;
}

export interface RenderDocumentOptions extends ReportInputs {
  steps?: Map<string, StepDef>;
  templates?: Map<string, Template>;
  /** instances minted per template per run (for the template blurb) */
  perTemplate?: number;
}

/** Render a case set (and optionally a run's evidence + triage proposals) as markdown. */
export function renderDocument({ loaded, steps, templates, sections, evidenceText, triageProposals, perTemplate = 5 }: RenderDocumentOptions): string {
  const lines: string[] = [];
  const { runHeader, verdictFor, triageFor, mintedCases, groups, sectionFor, exchangesFor, durationFor } = buildReportModel({ loaded, sections, evidenceText, triageProposals });

  lines.push(runHeader
    ? `# Peira run report — seed ${runHeader.seed}: ${runHeader.counts.pass} pass / ${runHeader.counts.fail} fail / ${runHeader.counts.error} error`
    : '# Peira test cases');
  lines.push('');
  lines.push('*Generated by `peira render` — one-way documentation. The JSON cases and the intent are the sources of truth; regenerate this file, never edit it.*');
  lines.push('');

  for (const [intentId, cases] of groups) {
    const section = sectionFor.get(intentId);
    lines.push(`## ${section ? section.title : intentId}`);
    lines.push('');
    if (section) {
      lines.push(section.text.trim().split('\n').map((l) => `> ${l}`).join('\n'));
      lines.push('');
    }
    for (const caseObj of cases) {
      lines.push(renderCase(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id), exchanges: exchangesFor.get(caseObj.id), durationMs: durationFor.get(caseObj.id) }));
      lines.push('');
    }
  }

  if (mintedCases.length > 0) {
    lines.push('## Minted from invariant templates (this run)');
    lines.push('');
    for (const caseObj of mintedCases) {
      lines.push(renderCase(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id), exchanges: exchangesFor.get(caseObj.id), durationMs: durationFor.get(caseObj.id) }));
      lines.push('');
    }
  }

  if (templates && templates.size > 0) {
    lines.push('## Invariant templates');
    lines.push('');
    for (const tpl of templates.values()) {
      lines.push(renderTemplate(tpl, perTemplate));
      lines.push('');
    }
  }

  if (steps && steps.size > 0) {
    lines.push('## Escape-hatch steps (generated procedure, assertion-free by contract)');
    lines.push('');
    for (const def of steps.values()) {
      lines.push(`- \`${def.id}\`${def.title ? ` — ${def.title}` : ''}: reads ${def.reads.join(', ') || '—'} → produces ${def.produces.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
