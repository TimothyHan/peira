// Thin fetch wrapper. The one classification that matters lives here: a failure BEFORE any
// HTTP response exists (connection refused, DNS, socket timeout) throws InfraError, which the
// runner records as verdict `error` — never `fail` (RFC 0001 §4.7).

import { REQUEST_TIMEOUT_MS } from './constants.js';
import { InfraError } from './errors.js';
import type { AuthAttachment } from './auth.js';
import type { BasicPrincipal } from './types.js';

/** A resolved multipart body: fields already interpolated, files already read (RFC 0005). */
export interface MultipartBody {
  fields: Record<string, string | object>;
  files: Array<{ field: string; filename: string; mimetype: string; data: Buffer }>;
}

export { InfraError };

export interface HttpRequestOptions {
  baseUrl: string;
  /** lowercase HTTP method */
  method: string;
  route: string;
  query?: Record<string, unknown>;
  /** JSON-serializable; skipped for GET. Mutually exclusive with multipart. */
  body?: unknown;
  /** multipart/form-data instead of a JSON body; fetch sets the boundary */
  multipart?: MultipartBody;
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

export async function httpRequest({ baseUrl, method, route, query, body, multipart, auth, followRedirects = true, timeoutMs = REQUEST_TIMEOUT_MS }: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(route, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  const requestHeaders: Record<string, string> = { ...authHeaders(auth) };
  const sendBody = method !== 'get' && body !== undefined && !multipart;
  if (sendBody) requestHeaders['content-type'] = 'application/json';
  let form: FormData | undefined;
  if (multipart && method !== 'get') {
    // no content-type header of our own: fetch writes multipart/form-data with the boundary
    form = new FormData();
    for (const [name, value] of Object.entries(multipart.fields)) {
      form.append(name, typeof value === 'string' ? value : JSON.stringify(value));
    }
    for (const f of multipart.files) form.append(f.field, new Blob([f.data], { type: f.mimetype }), f.filename);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: form ?? (sendBody ? JSON.stringify(body) : undefined),
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
  // Repeated headers arrive joined with ", " — except Set-Cookie, which the Fetch spec keeps
  // as separate entries, so Object.fromEntries kept only the LAST cookie (RFC 0004 O5).
  // getSetCookie() returns them all; join the same way so $contains matches any one of them.
  const headers: Record<string, string> = Object.fromEntries(res.headers.entries());
  const cookies: string[] =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : []; // Node < 18.14: fall back to whatever entries() gave us
  if (cookies.length > 0) headers['set-cookie'] = cookies.join(', ');
  return {
    status: res.status,
    headers,
    body: parsed,
    requestHeaders,
    elapsedMs: Math.round(performance.now() - started),
  };
}
