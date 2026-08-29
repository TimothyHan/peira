// `peira render` — deterministic, zero-LLM rendering of case artifacts into readable markdown.
// STRICTLY ONE-WAY: the output is generated documentation, never parsed back, never edited,
// never a source of truth (invariant 2). Regenerate it like `stats`; do not commit it.

import { parseEvidence } from './triage.js';

const cap = (text, n = 140) => (text.length > n ? text.slice(0, n) + ' …' : text);

/** Replace matcher objects with readable tokens, then compact-stringify. */
function fmtExpected(expected) {
  const walk = (node) => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if ('$any' in node && Object.keys(node).length === 1) return `<any ${node.$any}>`;
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    if (Array.isArray(node)) return node.map(walk);
    return node;
  };
  return cap(JSON.stringify(walk(expected)));
}

function fmtAuth(auth) {
  if (auth === undefined) return 'anonymously';
  if (typeof auth === 'string') return `as ${auth.slice('$users.'.length)}`;
  return `with credentials "${auth.username}" / "${auth.password}"`;
}

function fmtRequest(req) {
  const query = req.query ? '?' + Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join('&') : '';
  const body = req.body !== undefined ? ` with body ${cap(JSON.stringify(req.body))}` : '';
  return `${req.method.toUpperCase()} ${req.route}${query} ${fmtAuth(req.auth)}${body}`;
}

function fmtExpectPhrase(expect) {
  const parts = [];
  if ('status' in expect) parts.push(`the response is ${expect.status}`);
  if ('body' in expect) parts.push(`the body matches ${fmtExpected(expect.body)}`);
  if ('bodySchema' in expect) parts.push(`the body satisfies the schema ${cap(JSON.stringify(expect.bodySchema), 100)}`);
  return parts.join(', and ') || 'nothing is asserted';
}

function renderStepLine(step, steps) {
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

/**
 * Render one case as Given/When/Then lines.
 * @param {object} caseObj
 * @param {{steps?: Map<string, object>, verdict?: import('./types.js').Verdict}} [opts]
 */
export function renderCase(caseObj, { steps, verdict } = {}) {
  const lines = [];
  const icon = verdict ? { pass: '✅', fail: '❌', error: '🟡' }[verdict.verdict] + ' ' : '';
  lines.push(`### ${icon}${caseObj.id}${caseObj.title ? ` — ${caseObj.title}` : ''}`);
  if (caseObj.notes) lines.push(`> ${caseObj.notes}`);
  lines.push('');
  for (const [i, step] of (caseObj.setup ?? []).entries()) {
    lines.push(`- **${i === 0 ? 'Given' : 'And'}**  ${renderStepLine(step, steps)}`);
  }
  const test = caseObj.test;
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
  return lines.join('\n');
}

function renderTemplate(tpl, perRun) {
  const lines = [];
  lines.push(`### ${tpl.id}${tpl.title ? ` — ${tpl.title}` : ''}`);
  lines.push('');
  const holes = Object.entries(tpl.holes).map(([name, decl]) =>
    `\`${name}\`: ${decl.kind}${decl.distinctFrom ? ` (distinct from \`${decl.distinctFrom}\`)` : ''}`,
  );
  lines.push(`- **For any** ${holes.join('; ')} — mints ${perRun} seeded instances per run`);
  for (const [i, step] of (tpl.setup ?? []).entries()) {
    lines.push(`- **${i === 0 ? 'Given' : 'And'}**  ${renderStepLine(step, undefined)}`);
  }
  lines.push(`- **When**   ${renderStepLine({ ...tpl.test, expect: undefined }, undefined)}`);
  if (tpl.test.expect) lines.push(`- **Then**   ${fmtExpectPhrase(tpl.test.expect)}`);
  lines.push(`- *From intent \`${tpl.from.intent}\` @ \`${tpl.from.hash}\`*`);
  return lines.join('\n');
}

/**
 * Render a case set (and optionally a run's evidence) as a markdown document.
 * @param {object} opts
 * @param {Array<{file: string, caseObj: object}>} opts.loaded
 * @param {Map<string, object>} [opts.steps]
 * @param {Map<string, object>} [opts.templates]
 * @param {Array<{id: string, title: string, text: string}>} [opts.sections] intent sections to quote
 * @param {string} [opts.evidenceText] a run's evidence JSONL — turns the document into a run report
 * @param {number} [opts.perTemplate] instances minted per template per run (for the template blurb)
 * @returns {string} markdown
 */
export function renderDocument({ loaded, steps, templates, sections, evidenceText, perTemplate = 5 }) {
  const lines = [];
  const verdictFor = new Map();
  let mintedCases = [];
  let runHeader = null;

  if (evidenceText) {
    const parsed = parseEvidence(evidenceText);
    for (const v of parsed.verdicts) verdictFor.set(v.id, v);
    const counts = { pass: 0, fail: 0, error: 0 };
    for (const v of parsed.verdicts) counts[v.verdict] += 1;
    runHeader = { seed: parsed.seed, counts };
    mintedCases = [...parsed.definitions.values()].filter((d) => d?.from?.template !== undefined);
  }

  lines.push(runHeader
    ? `# Peira run report — seed ${runHeader.seed}: ${runHeader.counts.pass} pass / ${runHeader.counts.fail} fail / ${runHeader.counts.error} error`
    : '# Peira test cases');
  lines.push('');
  lines.push('*Generated by `peira render` — one-way documentation. The JSON cases and the intent are the sources of truth; regenerate this file, never edit it.*');
  lines.push('');

  const sectionFor = new Map((sections ?? []).map((s) => [s.id, s]));
  const groups = new Map();
  for (const { caseObj } of loaded) {
    const key = caseObj.from?.intent ?? '(no lineage)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(caseObj);
  }

  for (const [intentId, cases] of groups) {
    const section = sectionFor.get(intentId);
    lines.push(`## ${section ? section.title : intentId}`);
    lines.push('');
    if (section) {
      lines.push(section.text.trim().split('\n').map((l) => `> ${l}`).join('\n'));
      lines.push('');
    }
    for (const caseObj of cases) {
      lines.push(renderCase(caseObj, { steps, verdict: verdictFor.get(caseObj.id) }));
      lines.push('');
    }
  }

  if (mintedCases.length > 0) {
    lines.push('## Minted from invariant templates (this run)');
    lines.push('');
    for (const caseObj of mintedCases) {
      lines.push(renderCase(caseObj, { steps, verdict: verdictFor.get(caseObj.id) }));
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
