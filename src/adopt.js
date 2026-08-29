// `peira adopt` — a ONE-TIME authoring assist that restructures an arbitrary markdown document
// (a Confluence export, a ticket dump, a legacy test plan) into Peira intent: one promise per
// section, every section carrying a stable `<!-- peira: id=… -->` tag so lineage survives
// future rewording.
//
// This is authoring, not runtime: the proposal is written to a file the HUMAN reviews and
// adopts as their own — from then on that file is the source of truth (invariant 2), and
// nothing ever normalizes silently at compile time. The gates here are deterministic: the
// output must parse into tagged, uniquely-idented sections, and a content-preservation report
// shows exactly which source lines did not survive, so the review is a diff, not an act of faith.

import { parseIntent } from './intent.js';

export function buildAdoptPrompt(sourceText) {
  return `You are the adoption assistant of Peira, an intent compiler for functional API testing.
Restructure the document below into Peira intent markdown. RESTRUCTURE, DO NOT REWRITE:

- Preserve every requirement sentence's meaning; prefer keeping original wording verbatim.
- One acceptance criterion or invariant per "##" section, with a short heading.
- Tag EVERY section, immediately under its heading:
  <!-- peira: id=<stable-kebab-id> kind=ac -->     (or kind=invariant for "for all …" claims)
  Ids must be unique, descriptive, and stable — they are permanent lineage anchors.
- Keep useful prose context (background, environment notes) in its own tagged sections too.
- If something cannot be placed (images, tables you cannot faithfully linearize), collect it
  under a final section titled "Unplaced content" so nothing silently disappears.
- Output ONLY the restructured markdown document. No commentary, no code fences.

## The document to adopt

${sourceText}
`;
}

const stripFences = (text) => text.replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, '').trim();

const normalizeLine = (line) =>
  line.replace(/^[\s#>*-]+/, '').replace(/^[\d.]+\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

function contentLines(text) {
  return text
    .split('\n')
    .map(normalizeLine)
    .filter((l) => l !== '' && !l.startsWith('<!--'));
}

/**
 * Gate a proposed adoption deterministically. Returns { markdown, sections, report, errors }.
 * @param {string} raw the model's reply
 * @param {string} sourceText the original document
 */
export function gateAdoptedDocument(raw, sourceText) {
  const markdown = stripFences(raw);
  const errors = [];
  let sections = [];
  try {
    sections = parseIntent(markdown);
  } catch (err) {
    return { markdown, sections, report: null, errors: [`proposal does not parse: ${err.message}`] };
  }
  if (sections.length === 0) errors.push('proposal contains no sections');
  const untagged = sections.filter((s) => !s.tagged).map((s) => s.id);
  if (untagged.length > 0) {
    errors.push(`sections without a peira tag (ids would be heading-derived and fragile): ${untagged.join(', ')}`);
  }
  if (errors.length > 0) return { markdown, sections, report: null, errors };

  const source = contentLines(sourceText);
  const result = new Set(contentLines(markdown));
  const dropped = source.filter((l) => !result.has(l));
  const report = {
    sourceLines: source.length,
    kept: source.length - dropped.length,
    dropped,
    sections: sections.length,
    invariants: sections.filter((s) => s.kind === 'invariant').length,
  };
  return { markdown, sections, report, errors };
}

/**
 * Adopt a document through an injected LLM transport.
 * @param {{sourceText: string, llm: (prompt: string) => Promise<string>}} opts
 */
export async function adoptDocument({ sourceText, llm }) {
  const raw = await llm(buildAdoptPrompt(sourceText));
  return gateAdoptedDocument(raw, sourceText);
}
