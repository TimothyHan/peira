// The deterministic runner (RFC 0001 §4.1, §4.7). Zero LLM. Sequential execution in sorted
// file order; verdicts are pass | fail | error and the two failure kinds are never conflated:
// fail = an assertion did not hold; error = infrastructure failed before an assertion could.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POLL_INTERVAL_MS, POLL_UNTIL_TIMEOUT_MS, DRAIN_TIMEOUT_MS, STEP_TIMEOUT_MS } from './constants.js';
import { resolveValue, UnresolvedTokenError } from './interpolate.js';
import { matchExpect } from './expect.js';
import { httpRequest, InfraError } from './http.js';
import { EvidenceLog } from './evidence.js';
import { mintAll } from './generate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seed-derived per-run discriminator (RFC 0001 invariant 8): same seed → same value. */
export function uniqueValue(seed, caseId, key) {
  return 'u' + createHash('sha256').update(`${seed}|${caseId}|${key}`).digest('hex').slice(0, 10);
}

class CaseFailure extends Error {
  constructor(reason, diffs = []) {
    super(reason);
    this.diffs = diffs;
  }
}

function extractPath(response, path) {
  return path.split('.').reduce((node, part) => (node == null ? undefined : node[part]), response);
}

function resolveAuth(auth, bed) {
  if (auth === undefined) return undefined;
  if (typeof auth === 'string') {
    const alias = auth.slice('$users.'.length);
    const principal = bed.users?.[alias];
    if (!principal) throw new CaseFailure(`auth: unknown bed principal "$users.${alias}"`);
    return principal;
  }
  return auth; // literal {username, password} — negative auth tests are the security section
}

const HARNESS_PATH = fileURLToPath(new URL('./step-harness.js', import.meta.url));

export function runHarness(job, timeoutMs = STEP_TIMEOUT_MS) {
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

async function executeInvocation(step, label, state) {
  const { ctx, baseUrl, evidence, caseId, steps } = state;
  const def = steps.get(step.step);
  if (!def) throw new CaseFailure(`${label}: unknown step "${step.step}"`); // validate prevents this

  const inputs = {};
  for (const name of def.reads) {
    if (step.bind && name in step.bind) inputs[name] = resolveValue(step.bind[name], ctx);
    else if (name in ctx.captures) inputs[name] = ctx.captures[name];
    else throw new CaseFailure(`${label}: step ${def.id} reads "${name}" — not available at runtime`);
  }

  const started = performance.now();
  const result = await runHarness({ code: def.code, inputs, baseUrl });
  const elapsedMs = Math.round(performance.now() - started);

  if (!result.ok) {
    if (result.kind === 'infra') throw new InfraError(`${label}: step ${def.id}: ${result.error}`);
    throw new CaseFailure(`${label}: step ${def.id} ${result.kind === 'contract' ? 'broke its contract' : 'failed'}: ${result.error}`);
  }
  const produced = {};
  const dropped = [];
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

async function executeStep(step, label, state) {
  if ('step' in step) return executeInvocation(step, label, state);
  const { ctx, bed, baseUrl, evidence, caseId } = state;
  const req = step.request;
  const auth = resolveAuth(req.auth, bed);
  const resolved = {
    baseUrl,
    method: req.method,
    route: resolveValue(req.route, ctx),
    query: req.query === undefined ? undefined : resolveValue(req.query, ctx),
    body: req.body === undefined ? undefined : resolveValue(req.body, ctx),
    auth,
  };

  const doRequest = async (attempt) => {
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
        headers: response.requestHeaders,
      },
      response: { status: response.status, headers: response.headers, body: response.body, elapsedMs: response.elapsedMs },
    });
    return response;
  };

  let response;
  if (step.pollUntil) {
    const timeoutMs = step.pollUntil.timeoutMs ?? POLL_UNTIL_TIMEOUT_MS;
    const deadline = performance.now() + timeoutMs;
    const until = resolveValue(step.pollUntil.until, ctx);
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
    const expected = resolveValue(step.expect, ctx);
    const diffs = matchExpect(expected, response);
    if (diffs.length > 0) throw new CaseFailure(`${label}: assertion failed`, diffs);
  }

  for (const [alias, path] of Object.entries(step.capture ?? {})) {
    const value = extractPath(response, path);
    if (value === undefined) {
      throw new CaseFailure(`${label}: capture "${alias}" — path ${path} not present in response`);
    }
    ctx.captures[alias] = value;
    state.captureAuth[alias] = auth;
    state.captureOrder.push(alias);
  }
}

async function drainCaptures(caseObj, state) {
  const { bed, baseUrl, evidence, ctx, caseId } = state;
  const probe = bed.drain;
  if (!probe) {
    evidence.append({ event: 'drain-skipped', case: caseId, reason: 'bed config declares no drain probe' });
    return;
  }
  const deadline = performance.now() + DRAIN_TIMEOUT_MS;
  for (const alias of state.captureOrder) {
    for (;;) {
      const response = await httpRequest({
        baseUrl,
        method: 'get',
        route: probe.route,
        query: { [probe.idParam]: String(ctx.captures[alias]) },
        auth: state.captureAuth[alias],
      });
      if (response.status < 200 || response.status >= 300) {
        evidence.append({ event: 'drain-skipped', case: caseId, alias, reason: `probe returned ${response.status} — captured value is not a drainable id` });
        break;
      }
      const current = extractPath(response, probe.statusPath);
      if (probe.terminal.includes(current)) break;
      if (performance.now() >= deadline) {
        throw new CaseFailure(`teardown.drain: "${alias}" still ${JSON.stringify(current)} after ${DRAIN_TIMEOUT_MS}ms`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
  evidence.append({ event: 'drain-complete', case: caseId, drained: state.captureOrder });
}

/** Run one case. Returns { id, verdict, reason?, diffs? }. */
export async function runCase(caseObj, { bed, baseUrl, seed, evidence, steps = new Map() }) {
  const caseId = caseObj.id;
  const state = {
    bed,
    baseUrl,
    evidence,
    caseId,
    steps,
    ctx: { captures: {}, unique: (key) => uniqueValue(seed, caseId, key) },
    captureAuth: {},
    captureOrder: [],
  };
  evidence.append({ event: 'case-start', case: caseId });

  let result = { id: caseId, verdict: 'pass' };
  try {
    const steps = (caseObj.setup ?? []).map((s, i) => [s, `setup[${i}]`]);
    steps.push([caseObj.test, 'test']);
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

  evidence.append({ event: 'case-verdict', ...result });
  return result;
}

function classify(caseId, err) {
  if (err instanceof InfraError) return { id: caseId, verdict: 'error', reason: err.message };
  if (err instanceof CaseFailure) return { id: caseId, verdict: 'fail', reason: err.message, diffs: err.diffs };
  if (err instanceof UnresolvedTokenError) return { id: caseId, verdict: 'fail', reason: err.message };
  throw err; // a runner bug must crash loudly, not masquerade as a verdict
}

/**
 * Run a case set sequentially. `loaded` is [{file, caseObj}] in execution order.
 * Returns { seed, verdicts, counts }.
 */
export async function runCases(loaded, { bed, baseUrl, seed, evidencePath = null, steps = new Map(), templates = new Map() }) {
  const evidence = new EvidenceLog(evidencePath);
  const resolvedBase = baseUrl ?? bed.baseUrl;

  // invariant templates mint fresh concrete cases for THIS run (RFC §4.4); the evidence log
  // carries each minted case in full — (template, seed, instance) regenerates it bit-for-bit
  const minted = mintAll(templates, { bedUsers: bed.users ?? {}, seed });
  evidence.append({ event: 'run-start', seed, baseUrl: resolvedBase, cases: loaded.length, minted: minted.length });
  const executable = [...loaded];
  for (const m of minted) {
    evidence.append({ event: 'minted', template: m.template, seed, instance: m.instance, case: m.caseObj });
    executable.push({ file: `minted:${m.caseObj.id}`, caseObj: m.caseObj });
  }

  const verdicts = [];
  for (const { caseObj } of executable) {
    verdicts.push(await runCase(caseObj, { bed, baseUrl: resolvedBase, seed, evidence, steps }));
  }

  const counts = { pass: 0, fail: 0, error: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  evidence.append({ event: 'run-end', seed, counts });
  return { seed, verdicts, counts, events: evidence.events };
}
