// Credential attachment (RFC 0002). A principal resolves to the headers a request must carry:
// Basic builds an Authorization header from username/password; a login principal performs its
// login ONCE per run and caches the resulting token; a static principal attaches a fixed token.
// The token is registered with the evidence log's secret registry at the moment it is known,
// so no event written afterwards can carry it in plaintext (invariant 9, revised).

import { httpRequest, basicHeaders } from './http.js';
import { InfraError } from './errors.js';
import type { EvidenceLog } from './evidence.js';
import type { BasicPrincipal, LoginPrincipal, Principal, StaticTokenPrincipal, TokenSend } from './types.js';

/** What a request actually carries for a principal. */
export interface AuthAttachment {
  headers: Record<string, string>;
}

export function isBasic(p: Principal): p is BasicPrincipal {
  return typeof (p as BasicPrincipal).username === 'string';
}
export function isLogin(p: Principal): p is LoginPrincipal {
  return (p as LoginPrincipal).login !== undefined && (p as LoginPrincipal).login !== null;
}
export function isStatic(p: Principal): p is StaticTokenPrincipal {
  return typeof (p as StaticTokenPrincipal).token === 'string';
}

/** The default for a literal `{"token": …}` in a case with no `send` (amendment F). */
export const DEFAULT_SEND: TokenSend = { header: 'authorization', format: 'Bearer {{token}}' };

export function basicAttachment(principal: BasicPrincipal): AuthAttachment {
  return { headers: basicHeaders(principal) };
}

export function tokenAttachment(token: string, send: TokenSend): AuthAttachment {
  if (send.cookie !== undefined) return { headers: { cookie: `${send.cookie}=${token}` } };
  // header names are case-insensitive on the wire; lowercase keeps evidence stable
  return { headers: { [send.header.toLowerCase()]: send.format.split('{{token}}').join(token) } };
}

function extractPath(response: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), response);
}

export interface TokenStoreOptions {
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * Per-run login cache. The cache holds the in-flight PROMISE, not the result: `--parallel` is an
 * in-process pool over shared state, and a result cache would let N workers reaching an
 * uncached principal at once log in N times (RFC 0002 §3.3). Login events are buffered and
 * flushed by the run in alias order, so the evidence file has the same shape serial or parallel.
 */
export class TokenStore {
  private readonly pending = new Map<string, Promise<AuthAttachment>>();
  private readonly events: Record<string, unknown>[] = [];
  private readonly baseUrl: string;
  private readonly timeoutMs: number | undefined;

  constructor({ baseUrl, timeoutMs }: TokenStoreOptions) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /** Resolve a bed principal to its attachment, logging in on first use. */
  resolve(alias: string, principal: Principal, evidence: EvidenceLog): Promise<AuthAttachment> {
    if (isBasic(principal)) return Promise.resolve(basicAttachment(principal));
    if (isStatic(principal)) {
      evidence.secrets.register(principal.token);
      return Promise.resolve(tokenAttachment(principal.token, principal.send));
    }
    let inflight = this.pending.get(alias);
    if (!inflight) {
      inflight = this.login(alias, principal, evidence);
      this.pending.set(alias, inflight);
    }
    return inflight;
  }

  private async login(alias: string, principal: LoginPrincipal, evidence: EvidenceLog): Promise<AuthAttachment> {
    const { login } = principal;
    const response = await httpRequest({
      baseUrl: this.baseUrl,
      method: login.method ?? 'post',
      route: login.route,
      body: login.body,
      timeoutMs: this.timeoutMs,
    });
    // only the status is recorded: the request carries the password, the response the token
    const event: Record<string, unknown> = { event: 'login', principal: alias, route: login.route, status: response.status, elapsedMs: response.elapsedMs };
    if (response.status < 200 || response.status >= 300) {
      this.events.push({ ...event, outcome: 'refused' });
      throw new InfraError(`login for $users.${alias}: ${login.method?.toUpperCase() ?? 'POST'} ${login.route} returned ${response.status}`);
    }
    const token = extractPath(response, login.token);
    if (typeof token !== 'string' || token === '') {
      this.events.push({ ...event, outcome: 'no-token' });
      throw new InfraError(`login for $users.${alias}: token path ${login.token} not present in the login response`);
    }
    const registered = evidence.secrets.register(token);
    this.events.push({ ...event, outcome: 'ok', redaction: registered ? 'registered' : 'too-short' });
    return tokenAttachment(token, login.send);
  }

  /** Append every buffered login event, in alias order. Called once by the run before run-end. */
  flush(evidence: EvidenceLog): void {
    const sorted = [...this.events].sort((a, b) => String(a.principal).localeCompare(String(b.principal)));
    for (const e of sorted) evidence.append(e);
    this.events.length = 0;
  }
}
