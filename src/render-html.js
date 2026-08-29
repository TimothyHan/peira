// HTML rendering for `peira render --format html`: a SELF-CONTAINED single file (inline CSS,
// no scripts, no external requests) an agent can hand to a browser, attach to a ticket, or
// serve as a CI artifact. Visual but deterministic: same inputs → byte-identical page.
// Same one-way rule as the markdown renderer: generated, never edited.

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

/** A CSS-only stacked verdict bar. Widths are deterministic to one decimal. */
function verdictBar(counts, small = false) {
  const total = counts.pass + counts.fail + counts.error;
  if (total === 0) return '';
  const pct = (n) => ((n / total) * 100).toFixed(1);
  const seg = (cls, n) => (n > 0 ? `<i class="seg ${cls}" style="width:${pct(n)}%" title="${cls} ${n}"></i>` : '');
  return `<div class="bar${small ? ' small' : ''}">${seg('pass', counts.pass)}${seg('fail', counts.fail)}${seg('error', counts.error)}</div>`;
}

function sectionCounts(cases, verdictFor) {
  const counts = { pass: 0, fail: 0, error: 0 };
  let graded = 0;
  for (const c of cases) {
    const v = verdictFor.get(c.id);
    if (v) {
      counts[v.verdict] += 1;
      graded += 1;
    }
  }
  return { counts, graded };
}

function caseCard(caseObj, { steps, verdict, triage }) {
  const cls = verdict ? verdict.verdict : 'doc';
  const badge = verdict ? `<span class="badge ${verdict.verdict}">${verdict.verdict.toUpperCase()}</span>` : '';
  const open = !verdict || verdict.verdict !== 'pass' ? ' open' : '';
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

  return `<details class="case ${cls}" id="${esc(caseObj.id)}"${open}>
<summary>${badge}<code>${esc(caseObj.id)}</code>${caseObj.title ? ` <span class="title">${esc(caseObj.title)}</span>` : ''}</summary>
<div class="body">
${caseObj.notes ? `<p class="notes">${esc(caseObj.notes)}</p>` : ''}
<table>${rows.join('\n')}</table>
<p class="lineage">from intent <code>${esc(from.intent)}</code> @ <code>${esc(from.hash)}</code>${minted}</p>
${failure}${triageBlock}
</div>
</details>`;
}

const CSS = `
:root { color-scheme: light dark; --pass:#1a7f37; --fail:#cf222e; --error:#bf8700; --drift:#8250df; --muted:#888; --line:#8883; }
* { box-sizing: border-box; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 62rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.35rem; margin-bottom: .25rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
code { font: 12.5px ui-monospace, monospace; background: #8881; padding: 0 .3em; border-radius: 3px; }
blockquote { border-left: 3px solid var(--line); margin: .5rem 0 1rem; padding: .25rem .75rem; color: var(--muted); white-space: pre-wrap; font-size: .88rem; }
.tiles { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1rem 0 .5rem; }
.tile { border: 1px solid var(--line); border-radius: 10px; padding: .6rem 1.1rem; min-width: 6.5rem; text-align: center; }
.tile b { display: block; font-size: 1.6rem; line-height: 1.2; }
.tile.pass b { color: var(--pass); } .tile.fail b { color: var(--fail); } .tile.error b { color: var(--error); }
.tile small { color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: .68rem; }
.bar { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: #8882; margin: .5rem 0 1.25rem; }
.bar.small { height: 8px; width: 7rem; margin: 0; flex: none; }
.seg.pass { background: var(--pass); } .seg.fail { background: var(--fail); } .seg.error { background: var(--error); }
.count { color: var(--muted); font-size: .8rem; font-weight: 400; }
.failindex { border: 1px solid #cf222e55; background: #cf222e0d; border-radius: 10px; padding: .6rem 1rem; margin: 1rem 0; }
.failindex a { color: inherit; }
.failindex li { margin: .15rem 0; }
details.case { border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; margin: .6rem 0; }
details.case.pass { border-left-color: var(--pass); } details.case.fail { border-left-color: var(--fail); }
details.case.error { border-left-color: var(--error); } details.case.doc { border-left-color: #8888; }
details.case > summary { cursor: pointer; padding: .5rem .85rem; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; list-style: none; }
details.case > summary::before { content: "▸"; color: var(--muted); }
details.case[open] > summary::before { content: "▾"; }
details.case .body { padding: 0 .85rem .75rem 1.9rem; }
.title { color: var(--muted); font-size: .9rem; }
table { border-collapse: collapse; } th { text-align: left; vertical-align: top; padding-right: .75rem; color: var(--muted); font-weight: 600; font-size: .85rem; }
td { padding-bottom: .2rem; font-size: .92rem; }
.badge { font-size: .68rem; font-weight: 700; padding: .12em .55em; border-radius: 999px; color: #fff; }
.badge.pass { background: var(--pass); } .badge.fail { background: var(--fail); } .badge.error { background: var(--error); }
.chip { font-size: .68rem; font-weight: 700; padding: .12em .55em; border-radius: 999px; border: 1.5px solid currentColor; }
.chip.bug { color: var(--fail); } .chip.drift { color: var(--drift); } .chip.flake { color: var(--error); }
.failure { background: #cf222e12; border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; font-size: .9rem; }
.failure ul { margin: .25rem 0 0 1rem; padding: 0; }
.triage { background: #8250df12; border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; font-size: .9rem; }
.diff { margin-top: .35rem; } del { color: var(--fail); } ins { color: var(--pass); text-decoration: none; }
.lineage, .notes { color: var(--muted); font-size: .82rem; margin: .4rem 0 0; }
footer { margin-top: 3rem; color: var(--muted); font-size: .8rem; }
@media print { details.case { break-inside: avoid; } details.case:not([open]) > summary ~ * { display: block; } }
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
  parts.push(`<p class="lineage">Generated by <code>peira render</code> — one-way documentation; the JSON cases and the intent are the sources of truth.</p>`);

  const allGraded = [...verdictFor.values()];
  if (runHeader) {
    const total = allGraded.length;
    parts.push(`<div class="tiles">
<div class="tile pass"><b>${runHeader.counts.pass}</b><small>pass</small></div>
<div class="tile fail"><b>${runHeader.counts.fail}</b><small>fail</small></div>
<div class="tile error"><b>${runHeader.counts.error}</b><small>error</small></div>
<div class="tile"><b>${total}</b><small>cases run</small></div>
<div class="tile"><b>${runHeader.seed}</b><small>seed</small></div>
</div>`);
    parts.push(verdictBar(runHeader.counts));

    const failures = allGraded.filter((v) => v.verdict !== 'pass');
    if (failures.length > 0) {
      parts.push(`<div class="failindex"><strong>Needs attention (${failures.length})</strong><ul>`);
      for (const v of failures) {
        const triage = triageFor.get(v.id);
        parts.push(`<li><span class="badge ${v.verdict}">${v.verdict.toUpperCase()}</span> <a href="#${esc(v.id)}"><code>${esc(v.id)}</code></a>${triage ? ` <span class="chip ${triage.classification}">triage: ${triage.classification}</span>` : ''} <span class="count">${esc(cap(v.reason ?? '', 90))}</span></li>`);
      }
      parts.push('</ul></div>');
    }
  }

  const renderGroup = (heading, cases, sectionText) => {
    const { counts, graded } = sectionCounts(cases, verdictFor);
    const chip = graded > 0 ? ` <span class="count">${counts.pass}/${graded} pass</span>${verdictBar(counts, true)}` : ` <span class="count">${cases.length} case(s)</span>`;
    parts.push(`<h2>${esc(heading)}${chip}</h2>`);
    if (sectionText) parts.push(`<blockquote>${esc(sectionText)}</blockquote>`);
    for (const caseObj of cases) {
      parts.push(caseCard(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id) }));
    }
  };

  for (const [intentId, cases] of groups) {
    const section = sectionFor.get(intentId);
    renderGroup(section ? section.title : intentId, cases, section ? section.text.trim() : null);
  }
  if (mintedCases.length > 0) renderGroup('Minted from invariant templates (this run)', mintedCases, null);

  if (templates && templates.size > 0) {
    parts.push('<h2>Invariant templates</h2>');
    for (const tpl of templates.values()) {
      const holes = Object.entries(tpl.holes)
        .map(([name, decl]) => `<code>${esc(name)}</code>: ${esc(decl.kind)}${decl.distinctFrom ? ` (distinct from <code>${esc(decl.distinctFrom)}</code>)` : ''}`)
        .join('; ');
      parts.push(`<details class="case doc" open><summary><code>${esc(tpl.id)}</code>${tpl.title ? ` <span class="title">${esc(tpl.title)}</span>` : ''}</summary><div class="body"><p>For any ${holes} — mints ${perTemplate} seeded instances per run.</p></div></details>`);
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
