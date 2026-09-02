// Thin fetch wrapper. The one classification that matters lives here: a failure BEFORE any
// HTTP response exists (connection refused, DNS, socket timeout) throws InfraError, which the
// runner records as verdict `error` — never `fail` (RFC 0001 §4.7).

import { REQUEST_TIMEOUT_MS } from './constants.js';
import { InfraError } from './errors.js';
import type { AuthAttachment } from './auth.js';
import type { BasicPrincipal } from './types.js';

export { InfraError };

export interface HttpRequestOptions {
  baseUrl: string;
  /** lowercase HTTP method */
  method: string;
  route: string;
  query?: Record<string, unknown>;
  /** JSON-serializable; skipped for GET */
  body?: unknown;
  /**
   * Resolved credential headers, or — for direct callers such as tests and steps' ctx.aut —
   * a Basic principal, encoded here. Absent = anonymous. Both shapes stay supported: this
   * function is exported, and RFC 0002's back-compat criterion covers its callers too.
   */
  auth?: AuthAttachment | BasicPrincipal;
  /** default true (fetch's own default); false surfaces the 3xx itself — amendment (E) */
  followRedirects?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  requestHeaders: Record<string, string>;
  elapsedMs: number;
}

/** The Basic scheme, in one place — auth.ts builds its attachment through this too. */
export function basicHeaders({ username, password }: BasicPrincipal): Record<string, string> {
  return { authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') };
}

function authHeaders(auth: AuthAttachment | BasicPrincipal | undefined): Record<string, string> {
  if (!auth) return {};
  if ('headers' in auth) return auth.headers;
  return basicHeaders(auth);
}

export async function httpRequest({ baseUrl, method, route, query, body, auth, followRedirects = true, timeoutMs = REQUEST_TIMEOUT_MS }: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(route, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  const requestHeaders: Record<string, string> = { ...authHeaders(auth) };
  const sendBody = method !== 'get' && body !== undefined;
  if (sendBody) requestHeaders['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: sendBody ? JSON.stringify(body) : undefined,
      // undici returns the real 3xx (status + headers) under 'manual'; no opaque response
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });
  } catch (cause) {
    const err = cause as Error & { cause?: { code?: string } };
    throw new InfraError(`${method.toUpperCase()} ${url}: ${err.cause?.code ?? err.message}`, cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = text;
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
