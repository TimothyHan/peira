// `peira reference` — the complete vocabulary of the INSTALLED version, rendered from the
// artifacts that define it: the case and bed schemas (every property carries a description),
// the matcher registry, and the CLI usage text. Nothing here is hand-written twice. Docs in a
// user's repo freeze at whatever version scaffolded them; this is always current, which is why
// the AGENTS.md scaffold points agents here instead of restating the language (RFC 0004).

import { MATCHERS } from './expect.js';
import { CASE_SCHEMA } from './validate-core.js';
import { BED_SCHEMA } from './validate-bed.js';
import { USAGE } from './cli/context.js';
import type { JsonSchema } from './schema.js';

function shape(node: JsonSchema, root: JsonSchema): string {
  if (node.$ref) return shape(resolve(node.$ref, root), root);
  if (node.enum) return node.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (node.anyOf) return node.anyOf.map((n: JsonSchema) => shape(n, root)).join(' | ');
  const t = Array.isArray(node.type) ? node.type.join(' | ') : (node.type ?? 'any');
  return node.pattern ? `${t} matching /${node.pattern}/` : t;
}

function resolve(ref: string, root: JsonSchema): JsonSchema {
  let node: any = root;
  for (const part of ref.slice(2).split('/')) node = node[part];
  return node;
}

function rows(node: JsonSchema, root: JsonSchema, prefix = ''): string[] {
  const out: string[] = [];
  const required = new Set<string>(node.required ?? []);
  for (const [key, child] of Object.entries<JsonSchema>(node.properties ?? {})) {
    const c = child.$ref ? resolve(child.$ref, root) : child;
    const name = `${prefix}${key}${required.has(key) ? '' : '?'}`;
    out.push(`| \`${name}\` | ${shape(child, root)} | ${(c.description ?? child.description ?? '').replace(/\|/g, '\\|')} |`);
    if (c.properties && !child.$ref) out.push(...rows(c, root, `${prefix}${key}.`));
  }
  return out;
}

function table(title: string, node: JsonSchema, root: JsonSchema): string {
  return [`### ${title}`, '', '| key | shape | meaning |', '|---|---|---|', ...rows(node, root), ''].join('\n');
}

/** The whole reference as markdown. Deterministic; safe to diff between versions. */
export function renderReference({ version }: { version?: string } = {}): string {
  const root = CASE_SCHEMA;
  const defs = root.$defs as Record<string, JsonSchema>;
  const parts: string[] = [
    `# Peira reference${version ? ` — v${version}` : ''}`,
    '',
    'Generated from the installed version: the case and bed schemas, the matcher vocabulary, and the CLI.',
    'Anything not listed here is refused by the schema gate. The vocabulary grows by amendment, never by extension hooks.',
    '',
    '## The case',
    '',
    table('Top level', root, root),
    table('A request step (`setup[]` items and `test`)', defs.step, root),
    table('`request`', defs.request, root),
    table('A registry-step invocation (`setup[]` only — procedure, never assertions)', defs.invocation, root),
    table('`expect` — the oracle', defs.expect, root),
    '### The matcher vocabulary (closed)',
    '',
    '| matcher | meaning | amendment |',
    '|---|---|---|',
    ...MATCHERS.map((m) => `| \`${m.form}\` | ${m.meaning} | ${m.amendment} |`),
    '',
    'Matchers stand alone (no extra keys) and are legal in `expect.body`, `pollUntil.until`, and `expect.headers` values.',
    '',
    '## Interpolation',
    '',
    '| form | meaning |',
    '|---|---|',
    '| `"$alias"` | a string that IS the reference resolves to the captured value, type-preserving |',
    '| `{{alias}}` | inside any string, at any depth: String(value) spliced in. `{{{{` escapes a literal `{{`. A bare `$alias` inside a longer string is literal text — `validate` warns |',
    '| `{{unique.<key>}}` | seed-derived discriminator: hash(seed, case id, key). Same seed → same value |',
    '| `$users.<alias>` | a bed principal — legal only in `request.auth` |',
    '',
    '## The bed — `bed.json`',
    '',
    table('Top level', BED_SCHEMA, BED_SCHEMA),
    'Principal shapes under `users` (exactly one per alias):',
    '',
    ...['basicPrincipal', 'loginPrincipal', 'staticPrincipal'].map((k) => table(k, (BED_SCHEMA.$defs as Record<string, JsonSchema>)[k], BED_SCHEMA)),
    '## Responses',
    '',
    'JSON bodies are parsed; any other body (HTML, text, empty) arrives as a string — `$contains` and `$notContains` are the oracle for it, and `bodySchema` with `type: "string"` applies too.',
    'Server-rendered React (Next.js and others) separates adjacent text expressions with `<!-- -->`, so `총 {n}건` arrives as `총 <!-- -->2<!-- -->건` and the visible text is not a substring of the response. Assert on text that comes from one expression, or on a stable attribute value — not on visible text that spans an interpolation.',
    'A request sends either a JSON `body` or a `multipart` form (fields plus fixture files from the cases directory); never both.',
    'Repeated response headers arrive joined with `", "`, `Set-Cookie` included (every cookie is collected), so `$contains` on a header matches any one value.',
    '',
    '## Verdicts',
    '',
    '`pass` — every assertion held. `fail` — an assertion did not hold (including pollUntil non-convergence, a missing capture, an unresolved reference). `error` — infrastructure failed before an assertion could be judged (connection refused, a timeout ceiling, a refused login, a drain that will not settle). Never conflated. Exit codes: 0 all pass · 1 any fail/error or validation refused · 2 usage.',
    '',
    '## CLI',
    '',
    '```',
    USAGE,
    '```',
    '',
    '## Environment',
    '',
    '| variable | meaning |',
    '|---|---|',
    '| `PEIRA_CLAUDE_BIN` | the `claude` binary the model-facing commands (compile, triage, adopt) spawn; default `claude` on PATH. Point it at a canned-output script to run those commands with no model |',
    '| `NO_COLOR` | disables ANSI colour in CLI output |',
    '',
  ];
  return parts.join('\n');
}
