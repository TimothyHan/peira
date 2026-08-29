// The compiler (RFC 0001 §4.4). The LLM proposes; the deterministic gate disposes.
// Every candidate case passes through the SAME validateCase gate as hand-written cases — one
// gate, no second path. Lineage (`from`) is stamped mechanically by this module and never
// trusted from the model. Every section is accounted for in the manifest exactly once:
// compiled | refused | skipped | unparseable (RFC invariant 4).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateCase, validateStep } from './validate.js';

const CASE_SCHEMA_TEXT = readFileSync(
  fileURLToPath(new URL('../schema/case.schema.json', import.meta.url)),
  'utf8',
);

export function buildContract({ bedUsers } = {}) {
  const principals = Object.keys(bedUsers ?? {});
  return `You are the compiler stage of Peira, an intent compiler for functional API testing.
You translate ONE human-authored intent section into declarative JSON test cases. A separate
deterministic validator refuses anything malformed, so precision beats creativity.

## The case format (JSON Schema — a case is valid iff this schema admits it)

${CASE_SCHEMA_TEXT}

## Semantics you must honor

- A case is: optional "setup" steps, one "test" step, optional teardown {"drain": true}.
- A step is one request plus optional capture / pollUntil / expect.
- "expect" uses SUBSET matching (Jest toMatchObject semantics): objects match as subsets at
  every level, arrays index-wise with equal length, primitives strictly. Matchers allowed in
  expected bodies: {"$any": "string" | "number" | "boolean"} and literal null (present and null).
- "auth" is "$users.<alias>" for a bed principal, a literal {"username","password"} object for
  negative auth tests, or absent for anonymous.${principals.length > 0 ? ` Available principals: ${principals.map((p) => `$users.${p}`).join(', ')}.` : ''}
- "capture" maps an alias to a response path (e.g. {"requestId": "body.id"}); later steps
  reference it as "$requestId" (whole value) or "{{requestId}}" inside strings.
- Never wait by wall-clock. For eventually-consistent state, add "pollUntil": {"until": <expect>}
  to the step — it re-issues that step's request until the predicate matches. A case that
  leaves jobs running declares teardown {"drain": true}.
- Use only routes, fields, and behaviors the intent document supports. Do not invent endpoints,
  payload fields, or status codes the intent does not imply.
- "id" format: "CASE-<kebab-slug>-<3 digits>". "title": the acceptance-criterion text you are
  compiling. You may omit "from" — lineage is stamped mechanically after you.

## Escape hatch — steps (LAST RESORT, procedure only, never assertions)

When intent requires a computation no primitive can express (e.g. computing a signature),
emit a "steps" array alongside "cases". A step is generated procedure with a typed contract:

{"id": "STEP-<kebab-slug>-<3 digits>", "title": "...",
 "reads": ["<input names>"], "produces": ["<output names>"],
 "code": "<JS async function body: (inputs, ctx) => must return {<produced>: value, ...}>"}

- ctx.crypto = {createHmac, createHash, randomUUID} (node:crypto). ctx.aut({method, route,
  query, body, auth}) issues HTTP to the service under test only. Nothing else exists: no
  imports, no require, no process — a step computes values, nothing more.
- A step NEVER asserts. Assertion vocabulary in code is refused by the gate; the claim being
  verified always stays in a case's declarative "expect".
- A case invokes a step in its "setup" only: {"step": "STEP-...", "bind": {"<read>": <value>}}.
  Bound values interpolate; produced values become "$name" references for later steps and the
  test. Invocations cannot carry expect or capture.
- Prefer declarative. A step you did not need is a defect; a needed step is recorded demand
  that evolves the DSL.

## Output protocol — respond with ONLY one JSON object, no prose, no code fences

{"cases": [ <case>, ... ], "steps": [ <step>, ... ]}
  — one case per distinct behavior the section demands; "steps" only when genuinely needed; or
{"skip": "<reason>"}
  — when the section is not automatable as functional API cases (e.g. it prescribes manual,
    load, or stress testing, is prose context only, or duplicates coverage it names).

## Worked example

Intent: "A submitted job's status is visible to its submitter."
{"cases": [{
  "id": "CASE-status-visible-to-submitter-001",
  "title": "A submitted job's status is visible to its submitter",
  "setup": [{"request": {"method": "post", "route": "/example/submit", "auth": "$users.user_1",
              "body": {"payload": "x {{unique.nonce}}"}},
             "capture": {"jobId": "body.id"}}],
  "test": {"request": {"method": "get", "route": "/example/status", "auth": "$users.user_1",
            "query": {"id": "$jobId"}},
           "expect": {"status": 200, "body": {"id": "$jobId", "status": {"$any": "string"}}}}
}]}
`;
}

function parseModelOutput(text) {
  const stripped = text.replace(/```[a-z]*\n?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (parsed !== null && typeof parsed === 'object' && (Array.isArray(parsed.cases) || typeof parsed.skip === 'string')) {
      if (parsed.steps !== undefined && !Array.isArray(parsed.steps)) return null;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildPrompt(section, { contract, fullDocument }) {
  return `${contract}
## The full intent document (context — do NOT compile other sections)

${fullDocument}

## Compile ONLY this section

id: ${section.id}
kind: ${section.kind}
heading: ${section.title}

${section.text}
`;
}

/**
 * Compile sections through an injected LLM transport.
 * @param {Array} sections from intent.js
 * @param {object} opts
 * @param {(prompt: string) => Promise<string>} opts.llm
 * @param {object} [opts.bedUsers]
 * @param {string} [opts.fullDocument] whole-document context for the prompt
 * @param {string} [opts.model] recorded in the manifest
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {{accepted: Array<{sectionId: string, caseObj: object}>, manifest: object}}
 */
export async function compileSections(sections, { llm, bedUsers, steps = new Map(), fullDocument = '', model = null, onProgress = () => {} }) {
  const contract = buildContract({ bedUsers });
  const manifest = {
    model,
    contractHash: createHash('sha256').update(contract).digest('hex').slice(0, 12),
    sections: [],
  };
  const accepted = [];
  const acceptedSteps = [];
  const registry = new Map(steps); // existing steps + everything accepted this compile
  const usedIds = new Set();

  for (const section of sections) {
    onProgress(`compiling ${section.id} …`);
    const entry = { id: section.id, hash: section.hash, outcome: null, cases: [], refused: [] };
    manifest.sections.push(entry);

    let raw;
    try {
      raw = await llm(buildPrompt(section, { contract, fullDocument }));
    } catch (err) {
      entry.outcome = 'transport-error';
      entry.error = err.message;
      continue;
    }

    const output = parseModelOutput(raw);
    if (output === null) {
      entry.outcome = 'unparseable';
      entry.rawPreview = raw.slice(0, 400);
      continue;
    }
    if (output.skip) {
      entry.outcome = 'skipped';
      entry.skipReason = output.skip;
      continue;
    }

    // emitted steps first, so this section's cases can reference them
    for (const candidate of output.steps ?? []) {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        (entry.refusedSteps ??= []).push({ id: null, errors: ['step candidate is not an object'] });
        continue;
      }
      candidate.from = { intent: section.id, hash: section.hash }; // mechanical, like case lineage
      const { errors } = validateStep(candidate);
      if (typeof candidate.id === 'string' && registry.has(candidate.id)) {
        errors.push(`duplicate step id ${candidate.id}`);
      }
      if (errors.length > 0) {
        (entry.refusedSteps ??= []).push({ id: candidate.id ?? null, errors });
      } else {
        registry.set(candidate.id, candidate);
        (entry.steps ??= []).push(candidate.id);
        acceptedSteps.push({ sectionId: section.id, stepObj: candidate });
      }
    }

    for (const candidate of output.cases) {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        entry.refused.push({ id: null, errors: ['candidate is not an object'] });
        continue;
      }
      // lineage is mechanical — whatever the model wrote is overwritten, never trusted
      candidate.from = { intent: section.id, hash: section.hash };
      const { errors } = validateCase(candidate, { bedUsers, steps: registry });
      if (typeof candidate.id === 'string' && usedIds.has(candidate.id)) {
        errors.push(`duplicate case id ${candidate.id} — already emitted this compile`);
      }
      if (errors.length > 0) {
        entry.refused.push({ id: candidate.id ?? null, errors });
      } else {
        usedIds.add(candidate.id);
        entry.cases.push(candidate.id);
        accepted.push({ sectionId: section.id, caseObj: candidate });
      }
    }
    entry.outcome = entry.cases.length > 0 ? 'compiled' : 'refused';
  }

  return { accepted, acceptedSteps, manifest };
}
