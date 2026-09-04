// HTML rendering for `peira render --format html`: a SELF-CONTAINED single file (inline CSS,
// no scripts, no external requests) an agent can hand to a browser, attach to a ticket, or
// serve as a CI artifact. Visual but deterministic: same inputs → byte-identical page.
// Same one-way rule as the markdown renderer: generated, never edited.

import type { RenderDocumentOptions } from './render.js';
import { buildReportModel } from './render.js';

const esc = (v: unknown): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cap = (text: string, n = 160): string => (text.length > n ? text.slice(0, n) + ' …' : text);

function fmtExpected(expected: unknown): string {
  const walk = (node: any): any => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if ('$any' in node && Object.keys(node).length === 1) return `<any ${node.$any}>`;
      if ('$contains' in node && Object.keys(node).length === 1) return `<contains ${JSON.stringify(node.$contains)}>`;
      if ('$notContains' in node && Object.keys(node).length === 1) return `<not contains ${JSON.stringify(node.$notContains)}>`;
      if ('$absent' in node && Object.keys(node).length === 1) return '<absent>';
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
  const mp = req.multipart;
  const body = req.body !== undefined
    ? ` with body ${cap(JSON.stringify(req.body))}`
    : mp
      ? ` with multipart (${Object.keys(mp.fields ?? {}).length} field(s), ${(mp.files ?? []).map((f: any) => `${f.path}${f.mimetype ? ` as ${f.mimetype}` : ''}`).join(', ') || 'no files'})`
      : '';
  return `${req.method.toUpperCase()} ${req.route}${query} ${fmtAuth(req.auth)}${body}`;
}

function fmtExpectPhrase(expect: any): string {
  const parts = [];
  if ('status' in expect) parts.push(`the response is ${expect.status}`);
  if ('headers' in expect) parts.push(`the headers match ${fmtExpected(expect.headers)}`);
  if ('body' in expect) parts.push(`the body matches ${fmtExpected(expect.body)}`);
  if ('bodySchema' in expect) parts.push(`the body satisfies the schema ${cap(JSON.stringify(expect.bodySchema), 120)}`);
  return parts.join(', and ') || 'nothing is asserted';
}

function stepRow(kw: string, step: any, steps: Map<string, any> | undefined): string {
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
function verdictBar(counts: { pass: number; fail: number; error: number }, small = false): string {
  const total = counts.pass + counts.fail + counts.error;
  if (total === 0) return '';
  const pct = (n: number) => ((n / total) * 100).toFixed(1);
  const seg = (cls: string, n: number) => (n > 0 ? `<i class="seg ${cls}" style="width:${pct(n)}%" title="${cls} ${n}"></i>` : '');
  return `<div class="bar${small ? ' small' : ''}">${seg('pass', counts.pass)}${seg('fail', counts.fail)}${seg('error', counts.error)}</div>`;
}

function sectionCounts(cases: any[], verdictFor: Map<string, any>): { counts: { pass: number; fail: number; error: number }; graded: number } {
  const counts = { pass: 0, fail: 0, error: 0 };
  let graded = 0;
  for (const c of cases) {
    const v = verdictFor.get(c.id);
    if (v) {
      counts[v.verdict as 'pass' | 'fail' | 'error'] += 1;
      graded += 1;
    }
  }
  return { counts, graded };
}

function exchangeRows(exchanges: any[]): string {
  return exchanges.map((e: any) => {
    const query = e.request.query ? '?' + Object.entries(e.request.query).map(([k, v]) => `${k}=${v}`).join('&') : '';
    const sent = e.request.body !== undefined ? `<br><small>sent <code>${esc(cap(JSON.stringify(e.request.body), 200))}</code></small>` : '';
    return `<tr><td class="xchg-meta">${esc(e.phase)} #${e.attempt}</td><td>${esc(e.request.method.toUpperCase())} ${esc(e.request.route + query)}${sent}</td><td class="xchg-meta">${e.response.status}</td><td class="xchg-meta">${e.response.elapsedMs}ms</td><td><code>${esc(cap(JSON.stringify(e.response.body), 300))}</code></td></tr>`;
  }).join('\n');
}

function caseCard(caseObj: any, { steps, verdict, triage, exchanges, durationMs }: { steps?: Map<string, any>; verdict?: any; triage?: any; exchanges?: any[]; durationMs?: number }): string {
  const cls = verdict ? verdict.verdict : 'doc';
  const badge = verdict ? `<span class="badge ${verdict.verdict}">${verdict.verdict.toUpperCase()}</span>` : '';
  const open = !verdict || verdict.verdict !== 'pass' ? ' open' : '';
  const rows: string[] = [];
  (caseObj.setup ?? []).forEach((step: any, i: number) => rows.push(stepRow(i === 0 ? 'Given' : 'And', step, steps)));
  rows.push(stepRow('When', { ...caseObj.test, expect: undefined }, steps));
  if (caseObj.test.expect) rows.push(`<tr><th>Then</th><td>${esc(fmtExpectPhrase(caseObj.test.expect))}</td></tr>`);
  if (caseObj.teardown?.drain) rows.push(`<tr><th>Finally</th><td>every captured job is drained to a terminal state</td></tr>`);

  const from = caseObj.from;
  const minted = from.template !== undefined ? ` · minted from <code>${esc(from.template)}</code> seed ${from.seed} instance ${from.instance}` : '';
  const failure = verdict && verdict.verdict !== 'pass'
    ? `<div class="failure"><strong>${esc(verdict.reason ?? '')}</strong><ul>${(verdict.diffs ?? [])
        .map((d: any) => `<li>at <code>${esc(d.path)}</code>: expected <code>${esc(JSON.stringify(d.expected))}</code>, got <code>${esc(JSON.stringify(d.actual))}</code> (${esc(d.reason)})</li>`)
        .join('')}</ul></div>`
    : '';
  const triageBlock = triage
    ? `<div class="triage"><span class="chip ${triage.classification}">triage: ${triage.classification}</span> ${esc(triage.rationale)}${
        triage.intentDiff ? `<div class="diff">proposed intent diff for <code>${esc(triage.intentDiff.section)}</code>:<br><del>${esc(triage.intentDiff.current)}</del><br><ins>${esc(triage.intentDiff.proposed)}</ins></div>` : ''
      }${triage.finding ? `<div class="diff">finding: ${esc(triage.finding.title)} — expected ${esc(triage.finding.expected)}, actual ${esc(triage.finding.actual)}</div>` : ''}${
        triage.prescription ? `<div class="diff">prescription: ${esc(triage.prescription)}</div>` : ''
      }</div>`
    : '';

  const meta = durationMs ? `<span class="meta">${durationMs}ms · ${exchanges?.length ?? 0} exchange(s)</span>` : '';
  const observed = verdict && verdict.verdict !== 'pass' && exchanges?.length
    ? `<details class="observed" open><summary>Observed exchanges (${exchanges.length}) — the debugging log, bodies redacted at capture</summary><table class="xchg">${exchangeRows(exchanges)}</table></details>`
    : '';
  return `<details class="case ${cls}" id="${esc(caseObj.id)}"${open}>
<summary>${badge}<code>${esc(caseObj.id)}</code>${caseObj.title ? ` <span class="title">${esc(caseObj.title)}</span>` : ''}${meta}</summary>
<div class="body">
${caseObj.notes ? `<p class="notes">${esc(caseObj.notes)}</p>` : ''}
<table>${rows.join('\n')}</table>
<p class="lineage">from intent <code>${esc(from.intent)}</code> @ <code>${esc(from.hash)}</code>${minted}</p>
${failure}${observed}${triageBlock}
</div>
</details>`;
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg:#ffffff; --fg:#1f2328; --surface:#f6f8fa; --muted:#59636e; --line:#d1d9e0;
  --pass:#1a7f37; --fail:#cf222e; --error:#9a6700; --drift:#8250df;
  --pass-bg:#1a7f3714; --fail-bg:#cf222e12; --error-bg:#9a670014; --drift-bg:#8250df12;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0d1117; --fg:#e6edf3; --surface:#161b22; --muted:#8b949e; --line:#30363d;
    --pass:#3fb950; --fail:#f85149; --error:#d29922; --drift:#a371f7;
    --pass-bg:#3fb95021; --fail-bg:#f8514921; --error-bg:#d2992221; --drift-bg:#a371f721;
  }
}
/* CSS-only theme flip: checked = the opposite of the system preference (no scripts) */
:root:has(#theme-flip:checked) {
  --bg:#0d1117; --fg:#e6edf3; --surface:#161b22; --muted:#8b949e; --line:#30363d;
  --pass:#3fb950; --fail:#f85149; --error:#d29922; --drift:#a371f7;
  --pass-bg:#3fb95021; --fail-bg:#f8514921; --error-bg:#d2992221; --drift-bg:#a371f721;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:has(#theme-flip:checked) {
    --bg:#ffffff; --fg:#1f2328; --surface:#f6f8fa; --muted:#59636e; --line:#d1d9e0;
    --pass:#1a7f37; --fail:#cf222e; --error:#9a6700; --drift:#8250df;
    --pass-bg:#1a7f3714; --fail-bg:#cf222e12; --error-bg:#9a670014; --drift-bg:#8250df12;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 62rem; margin: 0 auto; padding: 2rem 1rem; background: var(--bg); color: var(--fg); }
.themebar { float: right; }
.themebar input { display: none; }
.themebar label { cursor: pointer; border: 1px solid var(--line); border-radius: 999px; padding: .2rem .7rem; font-size: .78rem; color: var(--muted); user-select: none; }
.themebar label:hover { border-color: var(--muted); }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
code { font: 12.5px ui-monospace, monospace; background: var(--surface); border: 1px solid var(--line); padding: 0 .3em; border-radius: 3px; }
blockquote { border-left: 3px solid var(--line); margin: .5rem 0 1rem; padding: .25rem .75rem; color: var(--muted); white-space: pre-wrap; font-size: .88rem; }
.tiles { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1rem 0 .5rem; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: .6rem 1.1rem; min-width: 6.5rem; text-align: center; }
.tile b { display: block; font-size: 1.6rem; line-height: 1.2; }
.tile.pass b { color: var(--pass); } .tile.fail b { color: var(--fail); } .tile.error b { color: var(--error); }
.tile small { color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: .68rem; }
.bar { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--surface); border: 1px solid var(--line); margin: .5rem 0 1.25rem; }
.bar.small { height: 8px; width: 7rem; margin: 0; flex: none; }
.seg.pass { background: var(--pass); } .seg.fail { background: var(--fail); } .seg.error { background: var(--error); }
.count { color: var(--muted); font-size: .8rem; font-weight: 400; }
.failindex { border: 1px solid var(--fail); background: var(--fail-bg); border-radius: 10px; padding: .6rem 1rem; margin: 1rem 0; }
.failindex a { color: inherit; }
.failindex li { margin: .15rem 0; }
details.case { background: var(--surface); border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; margin: .6rem 0; }
details.case.pass { border-left-color: var(--pass); } details.case.fail { border-left-color: var(--fail); }
details.case.error { border-left-color: var(--error); } details.case.doc { border-left-color: var(--muted); }
details.case > summary { cursor: pointer; padding: .5rem .85rem; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; list-style: none; }
details.case > summary::before { content: "\\25B8"; color: var(--muted); }
details.case[open] > summary::before { content: "\\25BE"; }
details.case .body { padding: 0 .85rem .75rem 1.9rem; }
.title { color: var(--muted); font-size: .9rem; }
table { border-collapse: collapse; } th { text-align: left; vertical-align: top; padding-right: .75rem; color: var(--muted); font-weight: 600; font-size: .85rem; }
td { padding-bottom: .2rem; font-size: .92rem; }
.badge { font-size: .68rem; font-weight: 700; padding: .12em .55em; border-radius: 999px; color: var(--bg); }
.badge.pass { background: var(--pass); } .badge.fail { background: var(--fail); } .badge.error { background: var(--error); }
.chip { font-size: .68rem; font-weight: 700; padding: .12em .55em; border-radius: 999px; border: 1.5px solid currentColor; }
.chip.bug { color: var(--fail); } .chip.drift { color: var(--drift); } .chip.flake { color: var(--error); }
.failure { background: var(--fail-bg); border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; font-size: .9rem; }
.failure ul { margin: .25rem 0 0 1rem; padding: 0; }
.triage { background: var(--drift-bg); border-radius: 6px; padding: .5rem .75rem; margin-top: .5rem; font-size: .9rem; }
.diff { margin-top: .35rem; } del { color: var(--fail); } ins { color: var(--pass); text-decoration: none; }
.lineage, .notes { color: var(--muted); font-size: .82rem; margin: .4rem 0 0; }
.meta { margin-left: auto; color: var(--muted); font-size: .78rem; }
.env { color: var(--muted); font-size: .82rem; margin: .25rem 0 0; }
.cats { margin: .35rem 0 0; display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; font-size: .8rem; color: var(--muted); }
details.observed { margin-top: .5rem; }
details.observed > summary { cursor: pointer; font-size: .85rem; color: var(--muted); }
table.xchg { width: 100%; margin-top: .35rem; font-size: .82rem; }
table.xchg td { border-top: 1px solid var(--line); padding: .25rem .5rem .25rem 0; vertical-align: top; word-break: break-word; }
.xchg-meta { color: var(--muted); white-space: nowrap; }
footer { margin-top: 3rem; color: var(--muted); font-size: .8rem; }
@media print { details.case { break-inside: avoid; } .themebar { display: none; } details.case:not([open]) > summary ~ * { display: block; } }
`;

/**
 * Render the report as a self-contained HTML page. Same inputs as renderDocument.
 * @returns {string} html
 */
export function renderHtmlDocument({ loaded, steps, templates, sections, evidenceText, triageProposals, perTemplate = 5 }: RenderDocumentOptions): string {
  const { runHeader, verdictFor, triageFor, mintedCases, groups, sectionFor, exchangesFor, durationFor } = buildReportModel({ loaded, sections, evidenceText, triageProposals });
  const parts = [];
  const title = runHeader ? `Peira run report — seed ${runHeader.seed}` : 'Peira test cases';
  parts.push(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>`);
  parts.push(`<span class="themebar"><input type="checkbox" id="theme-flip"><label for="theme-flip">☀ / ☾ theme</label></span>`);
  parts.push(`<h1>${esc(title)}</h1>`);
  parts.push(`<p class="lineage">Generated by <code>peira render</code> — one-way documentation; the JSON cases and the intent are the sources of truth.</p>`);

  const allGraded = [...verdictFor.values()];
  if (runHeader) {
    const total = allGraded.length;
    const rate = total > 0 ? ((runHeader.counts.pass / total) * 100).toFixed(1) : '0.0';
    parts.push(`<div class="tiles">
<div class="tile pass"><b>${runHeader.counts.pass}</b><small>pass</small></div>
<div class="tile fail"><b>${runHeader.counts.fail}</b><small>fail</small></div>
<div class="tile error"><b>${runHeader.counts.error}</b><small>error</small></div>
<div class="tile"><b>${rate}%</b><small>pass rate</small></div>
<div class="tile"><b>${total}</b><small>cases run</small></div>
<div class="tile"><b>${runHeader.seed}</b><small>seed</small></div>
</div>`);
    const env = [
      runHeader.baseUrl ? `bed <code>${esc(runHeader.baseUrl)}</code>` : null,
      runHeader.minted > 0 ? `${runHeader.minted} minted from templates` : null,
      runHeader.version ? `peira v${esc(runHeader.version)}` : null,
    ].filter(Boolean);
    if (env.length > 0) parts.push(`<p class="env">${env.join(' · ')}</p>`);
    parts.push(verdictBar(runHeader.counts));

    const failures = allGraded.filter((v) => v.verdict !== 'pass');
    if (failures.length > 0) {
      const catCounts: Record<string, number> = {};
      for (const v of failures) {
        const key = v.verdict === 'error' ? 'error' : (triageFor.get(v.id)?.classification ?? 'untriaged');
        catCounts[key] = (catCounts[key] ?? 0) + 1;
      }
      const catChip = (key: string, n: number) =>
        key === 'error' ? `<span class="badge error">ERROR ${n}</span>` :
        key === 'untriaged' ? `<span class="count">untriaged ${n}</span>` :
        `<span class="chip ${key}">${key} ${n}</span>`;
      parts.push(`<div class="failindex"><strong>Needs attention (${failures.length})</strong><div class="cats">${Object.entries(catCounts).map(([k, n]) => catChip(k, n)).join(' ')}</div><ul>`);
      for (const v of failures) {
        const triage = triageFor.get(v.id);
        parts.push(`<li><span class="badge ${v.verdict}">${v.verdict.toUpperCase()}</span> <a href="#${esc(v.id)}"><code>${esc(v.id)}</code></a>${triage ? ` <span class="chip ${triage.classification}">triage: ${triage.classification}</span>` : ''} <span class="count">${esc(cap(v.reason ?? '', 90))}</span></li>`);
      }
      parts.push('</ul></div>');
    }
  }

  const renderGroup = (heading: string, cases: any[], sectionText?: string | null): void => {
    const { counts, graded } = sectionCounts(cases, verdictFor);
    const chip = graded > 0 ? ` <span class="count">${counts.pass}/${graded} pass</span>${verdictBar(counts, true)}` : ` <span class="count">${cases.length} case(s)</span>`;
    parts.push(`<h2>${esc(heading)}${chip}</h2>`);
    if (sectionText) parts.push(`<blockquote>${esc(sectionText)}</blockquote>`);
    for (const caseObj of cases) {
      parts.push(caseCard(caseObj, { steps, verdict: verdictFor.get(caseObj.id), triage: triageFor.get(caseObj.id), exchanges: exchangesFor.get(caseObj.id), durationMs: durationFor.get(caseObj.id) }));
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
        .map(([name, decl]: [string, any]) => `<code>${esc(name)}</code>: ${esc(decl.kind)}${decl.distinctFrom ? ` (distinct from <code>${esc(decl.distinctFrom)}</code>)` : ''}`)
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
