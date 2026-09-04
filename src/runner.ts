// The deterministic runner (RFC 0001 §4.1, §4.7). Zero LLM. Execution in sorted file order —
// serially by default, or on a bounded worker pool (`parallel`) whose determinism holds because
// every per-case input (seed-derived uniques, captures) is independent of the other cases, and
// whose evidence log is flushed in case order so the file reads identically either way.
// Verdicts are pass | fail | error and the two failure kinds are never conflated:
// fail = an assertion did not hold; error = infrastructure failed before an assertion could.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { POLL_INTERVAL_MS, POLL_UNTIL_TIMEOUT_MS, DRAIN_TIMEOUT_MS, STEP_TIMEOUT_MS } from './constants.js';
import { resolveValue, UnresolvedTokenError, type ResolveContext } from './interpolate.js';
import { matchExpect, type ExpectDef } from './expect.js';
import { httpRequest, type HttpResponse } from './http.js';
import { CaseFailure, InfraError } from './errors.js';
import { EvidenceLog } from './evidence.js';
import { mintAll } from './generate.js';
import type { HarnessResult } from './step-harness.js';
import type { BedConfig, Case, LoadedCase, RunResult, StepDef, Template, Verdict } from './types.js';
import { TokenStore, basicAttachment, tokenAttachment, DEFAULT_SEND, type AuthAttachment } from './auth.js';
import { basename, resolve as resolvePath } from 'node:path';
import type { MultipartBody } from './http.js';
import { SecretRegistry } from './evidence.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seed-derived per-run discriminator (RFC 0001 invariant 8): same seed → same value. */
export function uniqueValue(seed: number, caseId: string, key: string): string {
  return 'u' + createHash('sha256').update(`${seed}|${caseId}|${key}`).digest('hex').slice(0, 10);
}

function extractPath(response: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), response);
}

/**
 * A request's `auth` → the headers it carries. Bed principals go through the run's TokenStore
 * (login once, cached); literals resolve here. A literal token is registered as a secret the
 * moment it is seen, so the case definition already in the log is the only place it could
 * have appeared — and `token` is a redacted key there (RFC 0002 §3.5).
 */
async function resolveAuth(auth: unknown, state: RunState): Promise<AuthAttachment | undefined> {
  if (auth === undefined) return undefined;
  if (typeof auth === 'string') {
    const alias = auth.slice('$users.'.length);
    const principal = state.bed.users?.[alias];
    if (!principal) throw new CaseFailure(`auth: unknown bed principal "$users.${alias}"`);
    return state.tokens.resolve(alias, principal, state.evidence);
  }
  const literal = auth as Record<string, unknown>;
  if (typeof literal.token === 'string') {
    state.evidence.secrets.register(literal.token);
    return tokenAttachment(literal.token, (literal.send as never) ?? DEFAULT_SEND); // amendment (F)
  }
  return basicAttachment(literal as { username: string; password: string }); // negative auth tests are the security section
}

const HARNESS_PATH = fileURLToPath(new URL('./step-harness.js', import.meta.url));
const TOOL_VERSION: string = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;

export interface HarnessJob {
  code: string;
  inputs: Record<string, unknown>;
  baseUrl: string;
}

export function runHarness(job: HarnessJob, timeoutMs: number = STEP_TIMEOUT_MS): Promise<HarnessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARNESS_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CaseFailure(`step harness timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new InfraError(`could not spawn step harness: ${err.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new CaseFailure(`step harness produced no result${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}

interface RunState {
  bed: BedConfig;
  baseUrl: string;
  /** the cases directory — multipart fixture paths resolve against it (RFC 0005) */
  baseDir: string;
  evidence: EvidenceLog;
  caseId: string;
  steps: Map<string, StepDef>;
  ctx: ResolveContext;
  tokens: TokenStore;
  /** the raw `auth` value that captured each alias — re-resolved (cache hit) for drain */
  captureAuth: Record<string, unknown>;
  captureOrder: string[];
}

/** Timeout ceilings for a run: the bed's declared latency envelope over the pinned defaults. */
function ceilings(bed: BedConfig) {
  const t = bed.timeouts ?? {};
  return {
    requestMs: t.requestMs,
    pollUntilMs: t.pollUntilMs ?? POLL_UNTIL_TIMEOUT_MS,
    drainMs: t.drainMs ?? DRAIN_TIMEOUT_MS,
    stepMs: t.stepMs ?? STEP_TIMEOUT_MS,
  };
}

type StepBlock = Record<string, any>;

async function executeInvocation(step: StepBlock, label: string, state: RunState): Promise<void> {
  const { ctx, baseUrl, evidence, caseId, steps } = state;
  const def = steps.get(step.step);
  if (!def) throw new CaseFailure(`${label}: unknown step "${step.step}"`); // validate prevents this

  const inputs: Record<string, unknown> = {};
  for (const name of def.reads) {
    if (step.bind && name in step.bind) inputs[name] = resolveValue(step.bind[name], ctx);
    else if (name in ctx.captures) inputs[name] = ctx.captures[name];
    else throw new CaseFailure(`${label}: step ${def.id} reads "${name}" — not available at runtime`);
  }

  const started = performance.now();
  const result = await runHarness({ code: def.code, inputs, baseUrl }, ceilings(state.bed).stepMs);
  const elapsedMs = Math.round(performance.now() - started);

  if (!result.ok) {
    if (result.kind === 'infra') throw new InfraError(`${label}: step ${def.id}: ${result.error}`);
    throw new CaseFailure(`${label}: step ${def.id} ${result.kind === 'contract' ? 'broke its contract' : 'failed'}: ${result.error}`);
  }
  const produced: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(result.outputs)) {
    (def.produces.includes(key) ? (produced[key] = value) : dropped.push(key));
  }
  const missing = def.produces.filter((name) => !(name in produced));
  if (missing.length > 0) {
    throw new CaseFailure(`${label}: step ${def.id} broke its contract — declared but did not produce: ${missing.join(', ')}`);
  }
  Object.assign(ctx.captures, produced);
  evidence.append({
    event: 'step',
    case: caseId,
    phase: label,
    step: def.id,
    reads: def.reads,
    produces: def.produces,
    ...(dropped.length > 0 ? { droppedOutputs: dropped } : {}),
    elapsedMs,
  });
}

async function executeStep(step: StepBlock, label: string, state: RunState): Promise<void> {
  if ('step' in step) return executeInvocation(step, label, state);
  const { ctx, bed, baseUrl, evidence, caseId } = state;
  const req = step.request;
  const auth = await resolveAuth(req.auth, state);
  const limits = ceilings(bed);
  // multipart (amendment J): fields interpolate like a body; fixtures are read from the cases
  // directory now, so a missing file is an infrastructure error, not a claim that failed
  let multipart: MultipartBody | undefined;
  if (req.multipart !== undefined) {
    const mp = req.multipart as { fields?: Record<string, unknown>; files?: Array<{ field: string; path: string; mimetype?: string; filename?: string }> };
    multipart = {
      fields: (resolveValue(mp.fields ?? {}, ctx) as Record<string, string | object>),
      files: (mp.files ?? []).map((f) => {
        const abs = resolvePath(state.baseDir, f.path);
        let data: Buffer;
        try {
          data = readFileSync(abs);
        } catch (cause) {
          throw new InfraError(`${label}: multipart fixture ${f.path} could not be read (${abs})`, cause);
        }
        return { field: f.field, filename: f.filename ?? basename(f.path), mimetype: f.mimetype ?? 'application/octet-stream', data };
      }),
    };
  }
  const resolved = {
    baseUrl,
    method: req.method as string,
    route: resolveValue(req.route, ctx) as string,
    query: req.query === undefined ? undefined : (resolveValue(req.query, ctx) as Record<string, unknown>),
    body: req.body === undefined ? undefined : resolveValue(req.body, ctx),
    multipart,
    auth,
    followRedirects: req.followRedirects as boolean | undefined,
    timeoutMs: limits.requestMs,
  };

  const doRequest = async (attempt: number): Promise<HttpResponse> => {
    const response = await httpRequest(resolved);
    evidence.append({
      event: 'http',
      case: caseId,
      phase: label,
      attempt,
      request: {
        method: resolved.method,
        route: resolved.route,
        query: resolved.query,
        body: resolved.body,
        // never the bytes: names and sizes are the whole record of an upload
        ...(multipart
          ? { multipart: { fields: Object.keys(multipart.fields), files: multipart.files.map((f) => ({ field: f.field, filename: f.filename, mimetype: f.mimetype, bytes: f.data.length })) } }
          : {}),
        headers: response.requestHeaders,
      },
      response: { status: response.status, headers: response.headers, body: response.body, elapsedMs: response.elapsedMs },
    });
    return response;
  };

  let response: HttpResponse;
  if (step.pollUntil) {
    const timeoutMs = step.pollUntil.timeoutMs ?? limits.pollUntilMs;
    const deadline = performance.now() + timeoutMs;
    const until = resolveValue(step.pollUntil.until, ctx) as ExpectDef;
    let attempt = 0;
    let lastDiffs;
    for (;;) {
      response = await doRequest(attempt++);
      lastDiffs = matchExpect(until, response);
      if (lastDiffs.length === 0) break;
      if (performance.now() >= deadline) {
        throw new CaseFailure(`${label}: pollUntil did not converge within ${timeoutMs}ms (${attempt} attempts)`, lastDiffs);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } else {
    response = await doRequest(0);
  }

  if (step.expect) {
    const expected = resolveValue(step.expect, ctx) as ExpectDef;
    const diffs = matchExpect(expected, response);
    if (diffs.length > 0) throw new CaseFailure(`${label}: assertion failed`, diffs);
  }

  for (const [alias, path] of Object.entries((step.capture ?? {}) as Record<string, string>)) {
    const value = extractPath(response, path);
    if (value === undefined) {
      throw new CaseFailure(`${label}: capture "${alias}" — path ${path} not present in response`);
    }
    ctx.captures[alias] = value;
    state.captureAuth[alias] = req.auth;
    state.captureOrder.push(alias);
  }
}

async function drainCaptures(caseObj: Case, state: RunState): Promise<void> {
  const { bed, baseUrl, evidence, ctx, caseId } = state;
  const probe = bed.drain;
  if (!probe) {
    evidence.append({ event: 'drain-skipped', case: caseId, reason: 'bed config declares no drain probe' });
    return;
  }
  const limits = ceilings(bed);
  const deadline = performance.now() + limits.drainMs;
  for (const alias of state.captureOrder) {
    for (;;) {
      const response = await httpRequest({
        baseUrl,
        method: 'get',
        route: probe.route,
        query: { [probe.idParam]: String(ctx.captures[alias]) },
        auth: await resolveAuth(state.captureAuth[alias], state),
        timeoutMs: limits.requestMs,
      });
      if (response.status < 200 || response.status >= 300) {
        evidence.append({ event: 'drain-skipped', case: caseId, alias, reason: `probe returned ${response.status} — captured value is not a drainable id` });
        break;
      }
      const current = extractPath(response, probe.statusPath);
      if (probe.terminal.includes(current as string)) break;
      if (performance.now() >= deadline) {
        throw new CaseFailure(`teardown.drain: "${alias}" still ${JSON.stringify(current)} after ${limits.drainMs}ms`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
  evidence.append({ event: 'drain-complete', case: caseId, drained: state.captureOrder });
}

export interface RunCaseOptions {
  bed: BedConfig;
  baseUrl: string;
  seed: number;
  evidence: EvidenceLog;
  steps?: Map<string, StepDef>;
  /** the run's login cache; a lone runCase gets a private one */
  tokens?: TokenStore;
  /** the cases directory; multipart fixture paths resolve against it (default: cwd) */
  baseDir?: string;
}

/** Run one case. */
export async function runCase(caseObj: Case, { bed, baseUrl, seed, evidence, steps = new Map(), tokens, baseDir = process.cwd() }: RunCaseOptions): Promise<Verdict> {
  const caseId = caseObj.id;
  const ownStore = tokens ?? new TokenStore({ baseUrl, timeoutMs: ceilings(bed).requestMs });
  const state: RunState = {
    bed,
    baseUrl,
    baseDir,
    evidence,
    caseId,
    steps,
    ctx: { captures: {}, unique: (key) => uniqueValue(seed, caseId, key) },
    tokens: ownStore,
    captureAuth: {},
    captureOrder: [],
  };
  evidence.append({ event: 'case-start', case: caseId, definition: caseObj });
  const started = performance.now();

  let result: Verdict = { id: caseId, verdict: 'pass' };
  try {
    const steps: Array<[StepBlock, string]> = ((caseObj.setup ?? []) as StepBlock[]).map((s, i) => [s, `setup[${i}]`]);
    steps.push([caseObj.test as StepBlock, 'test']);
    for (const [step, label] of steps) await executeStep(step, label, state);
  } catch (err) {
    result = classify(caseId, err);
  }

  if (caseObj.teardown?.drain) {
    try {
      await drainCaptures(caseObj, state);
    } catch (err) {
      if (result.verdict === 'pass') {
        // the case's own assertions already concluded; a queue that will not drain is infrastructure
        const drained = classify(caseId, err);
        result = { id: caseId, verdict: 'error', reason: drained.reason };
      }
    }
  }

  result.elapsedMs = Math.round(performance.now() - started);
  evidence.append({ event: 'case-verdict', ...result });
  if (!tokens) ownStore.flush(evidence); // standalone: nobody else will
  return result;
}

function classify(caseId: string, err: unknown): Verdict {
  if (err instanceof InfraError) return { id: caseId, verdict: 'error', reason: err.message };
  if (err instanceof CaseFailure) return { id: caseId, verdict: 'fail', reason: err.message, diffs: err.diffs };
  if (err instanceof UnresolvedTokenError) return { id: caseId, verdict: 'fail', reason: err.message };
  throw err; // a runner bug must crash loudly, not masquerade as a verdict
}

export interface RunCasesOptions {
  bed: BedConfig;
  baseUrl?: string;
  seed: number;
  evidencePath?: string | null;
  steps?: Map<string, StepDef>;
  templates?: Map<string, Template>;
  /** run only cases whose id passes; applies to minted template instances too */
  filter?: (id: string) => boolean;
  /** worker-pool width; 1 (default) is strictly serial */
  parallel?: number;
  /** 1-based deterministic slice for CI fan-out: shard `index` of `total` (interleaved) */
  shard?: { index: number; total: number };
  /** the cases directory; multipart fixture paths resolve against it (default: cwd) */
  baseDir?: string;
}

/** Run a case set in sorted file order, minting invariant-template instances for this run. */
export async function runCases(loaded: LoadedCase[], { bed, baseUrl, seed, evidencePath = null, steps = new Map(), templates = new Map(), filter, parallel = 1, shard, baseDir = process.cwd() }: RunCasesOptions): Promise<RunResult> {
  const runStarted = performance.now();
  // one secret registry for the whole run: a token learned by any case is scrubbed from every log
  const secrets = new SecretRegistry();
  const evidence = new EvidenceLog(evidencePath, secrets);
  const resolvedBase = (baseUrl ?? bed.baseUrl)!;
  const tokens = new TokenStore({ baseUrl: resolvedBase, timeoutMs: ceilings(bed).requestMs });

  // invariant templates mint fresh concrete cases for THIS run (RFC §4.4); the evidence log
  // carries each minted case in full — (template, seed, instance) regenerates it bit-for-bit
  const selectedLoaded = filter ? loaded.filter(({ caseObj }) => filter(caseObj.id)) : loaded;
  const minted = mintAll(templates, { bedUsers: bed.users ?? {}, seed }).filter((m) => !filter || filter(m.caseObj.id));
  let executable: Array<LoadedCase & { mintedFrom?: (typeof minted)[number] }> = [
    ...selectedLoaded,
    ...minted.map((m) => ({ file: `minted:${m.caseObj.id}`, caseObj: m.caseObj, mintedFrom: m })),
  ];
  // interleaved slice over the deterministic order — every shard of the same set at the same
  // seed is disjoint, and their union is exactly the unsharded run
  if (shard) executable = executable.filter((_, i) => i % shard.total === shard.index - 1);

  evidence.append({
    event: 'run-start',
    seed,
    baseUrl: resolvedBase,
    cases: executable.filter((e) => !e.mintedFrom).length,
    minted: executable.filter((e) => e.mintedFrom).length,
    ...(filter ? { filtered: true, casesTotal: loaded.length } : {}),
    ...(shard ? { shard: `${shard.index}/${shard.total}` } : {}),
    version: TOOL_VERSION,
  });
  for (const { mintedFrom: m } of executable) {
    if (m) evidence.append({ event: 'minted', template: m.template, seed, instance: m.instance, case: m.caseObj });
  }

  const verdicts: Verdict[] = new Array(executable.length);
  const width = Math.max(1, Math.min(Math.floor(parallel), executable.length || 1));
  if (width <= 1) {
    for (let i = 0; i < executable.length; i += 1) {
      verdicts[i] = await runCase(executable[i].caseObj, { bed, baseUrl: resolvedBase, seed, evidence, steps, tokens, baseDir });
    }
  } else {
    // each case writes to its own buffer; buffers flush into the main log strictly in case
    // order, so the evidence file is byte-identical in shape to a serial run's
    const buffers = executable.map(() => new EvidenceLog(null, secrets));
    const finished: boolean[] = new Array(executable.length).fill(false);
    let flushed = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= executable.length) return;
        verdicts[i] = await runCase(executable[i].caseObj, { bed, baseUrl: resolvedBase, seed, evidence: buffers[i], steps, tokens, baseDir });
        finished[i] = true;
        while (flushed < executable.length && finished[flushed]) evidence.adopt(buffers[flushed++]);
      }
    };
    await Promise.all(Array.from({ length: width }, worker));
  }

  const counts = { pass: 0, fail: 0, error: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  // timing accounting: wallMs is the run's span; httpMs sums every logged exchange (with
  // --parallel the sum can exceed the wall — they are totals, not a partition). On a serial
  // poll-free workload, wallMs − httpMs is the tool's own overhead.
  const wallMs = Math.round(performance.now() - runStarted);
  const httpMs = evidence.events.reduce(
    (sum, e) => sum + (e.event === 'http' ? (((e.response as { elapsedMs?: number }) ?? {}).elapsedMs ?? 0) : 0),
    0,
  );
  // login events land here, in alias order — same evidence shape serial or parallel
  tokens.flush(evidence);
  evidence.append({ event: 'run-end', seed, counts, wallMs, httpMs });
  return { seed, verdicts, counts, wallMs, httpMs, events: evidence.events };
}
