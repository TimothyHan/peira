// HTML rendering for `peira render --format html`: a SELF-CONTAINED single file (inline CSS,
// no external requests, no scripts) an agent can hand to a browser, attach to a ticket, or
// serve as a CI artifact. Same one-way rule as the markdown renderer: generated, never edited.

import { buildReportModel } from './render.js';

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cap = (text, n = 160) => (text.length > n ? text.slice(0, n) + ' …' : text);

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
  if ('bodySchema' in expect) parts.push(`the body satisfies the schema ${cap(JSON.stringify(expect.bodySchema), 120)}`);
  return parts.join(', and ') || 'nothing is asserted';
}

function stepRow(kw, step, steps) {
  if ('step' in step) {
    const def = steps?.get(step.step);
    const contract = def ? ` (reads ${def.reads.join(', ') || '—'} → produces ${def.produces.join(', ')})` : '';
    const bind = step.bind ? ` binding ${cap(JSON.stringify(step.bind), 120)}` : '';
    return `<tr><th>${kw}</th><td>runs generated procedure <code>${esc(step.step)}</code>${esc(contract)}${esc(bind)}</td></tr>`;
  }
  const capture = step.capture
    ? `<br><small>captures ${Object.entries(step.capture).map(([a, p]) => `<code>${esc(a)}</code> ← <code>${esc(p)}</code>`).join(', ')}</small>`
    : '';
  const poll = step.pollUntil
    ? `<br><small>polling until ${esc(fmtExpectPhrase(step.pollUntil.until))}${step.pollUntil.timeoutMs ? ` (timeout ${step.pollUntil.timeoutMs}ms)` : ''}</small>`
    : '';
  return `<tr><th>${kw}</th><td>${esc(fmtRequest(step.request))}${capture}${poll}</td></tr>`;
}

function caseCard(caseObj, { steps, verdict, triage }) {
  const badge = verdict ? `<span class="badge ${verdict.verdict}">${verdict.verdict.toUpperCase()}</span> ` : '';
  const rows = [];
  (caseObj.setup ?? []).forEach((step, i) => rows.push(stepRow(i === 0 ? 'Given' : 'And', step, steps)));
  rows.push(stepRow('When', { ...caseObj.test, expect: undefined }, steps));
  if (caseObj.test.expect) rows.push(`<tr><th>Then</th><td>${esc(fmtExpectPhrase(caseObj.test.expect))}</td></tr>`);
  if (caseObj.teardown?.drain) rows.push(`<tr><th>Finally</th><td>every captured job is drained to a terminal state</td></tr>`);

  const from = caseObj.from;
  const minted = from.template !== undefined ? ` · minted from <code>${esc(from.template)}</code> seed ${from.seed} instance ${from.instance}` : '';
  const failure = verdict && verdict.verdict !== 'pass'
    ? `<div class="failure"><strong>${esc(verdict.reason ?? '')}</strong><ul>${(verdict.diffs ?? [])
        .map((d) => `<li>at <code>${esc(d.path)}</code>: expected <code>${esc(JSON.stringify(d.expected))}</code>, got <code>${esc(JSON.stringify(d.actual))}</code> (${esc(d.reason)})</li>`)
        .join('')}</ul></div>`
    : '';
  const triageBlock = triage
    ? `<div class="triage"><span class="chip ${triage.classification}">triage: ${triage.classification}</span> ${esc(triage.rationale)}${
        triage.intentDiff ? `<div class="diff">proposed intent diff for <code>${esc(triage.intentDiff.section)}</code>:<br><del>${esc(triage.intentDiff.current)}</del><br><ins>${esc(triage.intentDiff.proposed)}</ins></div>` : ''
      }${triage.finding ? `<div class="diff">finding: ${esc(triage.finding.title)} — expected ${esc(triage.finding.expected)}, actual ${esc(triage.finding.actual)}</div>` : ''}${
        triage.prescription ? `<div class="diff">prescription: ${esc(triage.prescription)}</div>` : ''
      }</div>`
    : '';

  return `<article class="case">
<h3>${badge}<code>${esc(caseObj.id)}</code>${caseObj.title ? ` — ${esc(caseObj.title)}` : ''}</h3>
${caseObj.notes ? `<p class="notes">${esc(caseObj.notes)}</p>` : ''}
<table>${rows.join('\n')}</table>
<p class="lineage">from intent <code>${esc(from.intent)}</code> @ <code>${esc(from.hash)}</code>${minted}</p>
${failure}${triageBlock}
</article>`;
}

const CSS = `
:root { color-scheme: light dark; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
h3 { font-size: 1rem; margin: 0 0 .5rem; }
code { font: 13px ui-monospace, monospace; background: #8881; padding: 0 .25em; border-radius: 3px; }
blockquote { border-left: 3px solid #8886; margin: .5rem 0; padding: .25rem .75rem; color: #888; white-space: pre-wrap; }
article.case { border: 1px solid #8883; border-radius: 8px; padding: .75rem 1rem; margin: .75rem 0; }
table { border-collapse: collapse; } th { text-align: left; vertical-align: top; padding-right: .75rem; color: #888; font-weight: 600; }
td { padding-bottom: .2rem; }
.badge { font-size: .7rem; font-weight: 700; padding: .15em .5em; border-radius: 999px; color: #fff; vertical-align: middle; }
.badge.pass { background: #1a7f37; } .badge.fail { background: #cf222e; } .badge.error { background: #bf8700; }
.chip { font-size: .7rem; font-weight: 700; padding: .15em .5em; border-radius: 999px; border: 1px solid currentColor; }
.chip.bug { color: #cf222e; } .chip.drift { color: #8250df; } .chip.flake { color: #bf8700; }
.failure { background: #cf222e14; border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; }
.triage { background: #8250df14; border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; }
.diff { margin-top: .35rem; } del { color: #cf222e; } ins { color: #1a7f37; text-decoration: none; }
.lineage, .notes { color: #888; font-size: .85rem; margin: .35rem 0 0; }
.summary span { margin-right: 1rem; } footer { margin-top: 3rem; color: #888; font-size: .8rem; }
`;

/**
 * Render the report as a self-contained HTML page. Same inputs as renderDocument.
 * @returns {string} html
 */
export function renderHtmlDocument({ loaded, steps, templates, sections, evidenceText, triageProposals, perTemplate = 5 }) {
  const { runHeader, verdictFor, triageFor, mintedCases, groups, sectionFor } = buildReportModel({ loaded, sections, evidenceText, triageProposals });
  const parts = [];
  const title = runHeader ? `Peira run report — seed ${runHeader.seed}` : 'Peira test cases';
  parts.push(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>`);
  parts.push(`<h1>${esc(title)}</h1>`);
  if (runHeader) {
    parts.push(`<p class="summary"><span class="badge pass">PASS ${runHeader.counts.pass}</span><span class="badge fail">FAIL ${runHeader.counts.fail}</span><span class="badge error">ERROR ${runHeader.counts.error}</span></p>`);
  }
  parts.push(`<p><em>Generated by <code>peira render</code> — one-way documentation; the JSON cases and the intent are the sources of truth.</em></p>`);

  for (const [intentId, cases] of groups) {
    const section = sectionFor.get(intentId);
    parts.push(`<h2>${esc(section ? section.title : intentId)}</h2>`);
    if (section) parts.push(`<blockquote>${esc(section.text.trim())}</blockquote>`);
    for (const caseObj of cases) {
      parts.push(caseCard(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id) }));
    }
  }

  if (mintedCases.length > 0) {
    parts.push('<h2>Minted from invariant templates (this run)</h2>');
    for (const caseObj of mintedCases) {
      parts.push(caseCard(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id) }));
    }
  }

  if (templates && templates.size > 0) {
    parts.push('<h2>Invariant templates</h2>');
    for (const tpl of templates.values()) {
      const holes = Object.entries(tpl.holes)
        .map(([name, decl]) => `<code>${esc(name)}</code>: ${esc(decl.kind)}${decl.distinctFrom ? ` (distinct from <code>${esc(decl.distinctFrom)}</code>)` : ''}`)
        .join('; ');
      parts.push(`<article class="case"><h3><code>${esc(tpl.id)}</code>${tpl.title ? ` — ${esc(tpl.title)}` : ''}</h3><p>For any ${holes} — mints ${perTemplate} seeded instances per run.</p></article>`);
    }
  }

  if (steps && steps.size > 0) {
    parts.push('<h2>Escape-hatch steps</h2><ul>');
    for (const def of steps.values()) {
      parts.push(`<li><code>${esc(def.id)}</code>${def.title ? ` — ${esc(def.title)}` : ''}: reads ${esc(def.reads.join(', ') || '—')} → produces ${esc(def.produces.join(', '))}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<footer>peira — assertions are declarative, always.</footer></body></html>');
  return parts.join('\n');
}
