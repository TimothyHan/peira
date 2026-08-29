// The deterministic runner (RFC 0001 §4.1, §4.7). Zero LLM. Sequential execution in sorted
// file order; verdicts are pass | fail | error and the two failure kinds are never conflated:
// fail = an assertion did not hold; error = infrastructure failed before an assertion could.

import { createHash } from 'node:crypto';
import { POLL_INTERVAL_MS, POLL_UNTIL_TIMEOUT_MS, DRAIN_TIMEOUT_MS } from './constants.js';
import { resolveValue, UnresolvedTokenError } from './interpolate.js';
import { matchExpect } from './expect.js';
import { httpRequest, InfraError } from './http.js';
import { EvidenceLog } from './evidence.js';

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

async function executeStep(step, label, state) {
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
export async function runCase(caseObj, { bed, baseUrl, seed, evidence }) {
  const caseId = caseObj.id;
  const state = {
    bed,
    baseUrl,
    evidence,
    caseId,
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
export async function runCases(loaded, { bed, baseUrl, seed, evidencePath = null }) {
  const evidence = new EvidenceLog(evidencePath);
  const resolvedBase = baseUrl ?? bed.baseUrl;
  evidence.append({ event: 'run-start', seed, baseUrl: resolvedBase, cases: loaded.length });

  const verdicts = [];
  for (const { caseObj } of loaded) {
    verdicts.push(await runCase(caseObj, { bed, baseUrl: resolvedBase, seed, evidence }));
  }

  const counts = { pass: 0, fail: 0, error: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  evidence.append({ event: 'run-end', seed, counts });
  return { seed, verdicts, counts, events: evidence.events };
}
