// Thin fetch wrapper. The one classification that matters lives here: a failure BEFORE any
// HTTP response exists (connection refused, DNS, socket timeout) throws InfraError, which the
// runner records as verdict `error` — never `fail` (RFC 0001 §4.7).

import { REQUEST_TIMEOUT_MS } from './constants.js';
import { InfraError } from './errors.js';

export { InfraError };

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.method lowercase HTTP method
 * @param {string} opts.route
 * @param {object} [opts.query]
 * @param {*} [opts.body] JSON-serializable; skipped for GET
 * @param {{username: string, password: string}} [opts.auth] basic auth; absent = anonymous
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status: number, headers: object, body: *, requestHeaders: object, elapsedMs: number}>}
 */
export async function httpRequest({ baseUrl, method, route, query, body, auth, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const url = new URL(route, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  /** @type {Record<string, string>} */
  const requestHeaders = {};
  if (auth) {
    requestHeaders.authorization = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  }
  const sendBody = method !== 'get' && body !== undefined;
  if (sendBody) requestHeaders['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: sendBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new InfraError(`${method.toUpperCase()} ${url}: ${cause.cause?.code ?? cause.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed = text;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    // non-JSON body stays as text
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: parsed,
    requestHeaders,
    elapsedMs: Math.round(performance.now() - started),
  };
}
