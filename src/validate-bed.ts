// The bed gate (RFC 0002 §3.6) — the first one. The vendored schema validator takes
// additionalProperties only as a boolean and has no per-value schemas, so the top-level keys
// are checked by schema/bed.schema.json and every principal under `users` is checked here,
// strictly: exactly one shape, and the constraints a schema cannot say.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSchema, type JsonSchema } from './schema.js';
import { CAPTURE_PATH_PATTERN } from './validate-core.js';

export const BED_SCHEMA: JsonSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/bed.schema.json', import.meta.url)), 'utf8'),
);

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
const UNIQUE_REF = /\{\{\s*unique\.|"\$unique\./;

function checkSend(send: unknown, where: string, errors: string[]): void {
  if (send === null || typeof send !== 'object' || Array.isArray(send)) {
    errors.push(`${where}: send must be {"header", "format"} or {"cookie"}`);
    return;
  }
  const s = send as Record<string, unknown>;
  const hasHeader = 'header' in s || 'format' in s;
  const hasCookie = 'cookie' in s;
  if (hasHeader === hasCookie) {
    errors.push(`${where}: send is exactly one of {"header", "format"} or {"cookie"}`);
    return;
  }
  if (hasCookie) {
    if (typeof s.cookie !== 'string' || s.cookie === '') errors.push(`${where}.cookie must be a non-empty string`);
    return;
  }
  if (typeof s.header !== 'string' || s.header === '') errors.push(`${where}.header must be a non-empty string`);
  if (typeof s.format !== 'string') errors.push(`${where}.format must be a string`);
  else if (!s.format.includes('{{token}}')) errors.push(`${where}.format must contain {{token}} — got ${JSON.stringify(s.format)}`);
}

/** Validate one principal. Returns error messages; valid iff empty. */
export function validatePrincipal(alias: string, principal: unknown): string[] {
  const errors: string[] = [];
  const where = `users.${alias}`;
  if (principal === null || typeof principal !== 'object' || Array.isArray(principal)) {
    return [`${where}: a principal is an object`];
  }
  const p = principal as Record<string, unknown>;
  const shapes = [
    'username' in p || 'password' in p ? 'basic' : null,
    'login' in p ? 'login' : null,
    'token' in p ? 'static' : null,
  ].filter(Boolean) as string[];
  if (shapes.length !== 1) {
    errors.push(`${where}: a principal is exactly one of {"username","password"}, {"login": …}, or {"token","send"} — found ${shapes.length === 0 ? 'none of them' : shapes.join(' + ')}`);
    return errors;
  }
  const [shape] = shapes;
  if (shape === 'basic') {
    for (const k of ['username', 'password']) if (typeof p[k] !== 'string') errors.push(`${where}.${k} must be a string`);
    for (const k of Object.keys(p)) if (k !== 'username' && k !== 'password') errors.push(`${where}: unknown key "${k}"`);
    return errors;
  }
  if (shape === 'static') {
    if (typeof p.token !== 'string' || p.token === '') errors.push(`${where}.token must be a non-empty string`);
    if (!('send' in p)) errors.push(`${where}: a static token needs "send"`);
    else checkSend(p.send, `${where}.send`, errors);
    for (const k of Object.keys(p)) if (k !== 'token' && k !== 'send') errors.push(`${where}: unknown key "${k}"`);
    return errors;
  }
  // login
  for (const k of Object.keys(p)) if (k !== 'login') errors.push(`${where}: unknown key "${k}"`);
  const login = p.login;
  if (login === null || typeof login !== 'object' || Array.isArray(login)) return [...errors, `${where}.login must be an object`];
  const l = login as Record<string, unknown>;
  for (const k of Object.keys(l)) if (!['method', 'route', 'body', 'token', 'send'].includes(k)) errors.push(`${where}.login: unknown key "${k}"`);
  if (l.method !== undefined && (typeof l.method !== 'string' || !METHODS.has(l.method))) errors.push(`${where}.login.method must be one of get | post | put | delete | patch`);
  if (typeof l.route !== 'string' || !l.route.startsWith('/')) errors.push(`${where}.login.route must be a string starting with /`);
  if (typeof l.token !== 'string' || !CAPTURE_PATH_PATTERN.test(l.token)) {
    errors.push(`${where}.login.token must be a capture path rooted at status, body, or headers — got ${JSON.stringify(l.token)}`);
  }
  if (l.body !== undefined && UNIQUE_REF.test(JSON.stringify(l.body))) {
    errors.push(`${where}.login.body may not reference unique.* — unique values are derived per case, and a login belongs to a principal`);
  }
  if (!('send' in l)) errors.push(`${where}.login: "send" is required`);
  else checkSend(l.send, `${where}.login.send`, errors);
  return errors;
}

/** Validate a whole bed config. Returns error messages; valid iff empty. */
export function validateBed(bed: unknown): string[] {
  if (bed === null || typeof bed !== 'object' || Array.isArray(bed)) return ['bed config must be a JSON object'];
  const errors = validateSchema(BED_SCHEMA, bed).map((e) => e.message);
  const users = (bed as Record<string, unknown>).users;
  if (users !== undefined && users !== null && typeof users === 'object' && !Array.isArray(users)) {
    for (const [alias, principal] of Object.entries(users as Record<string, unknown>)) {
      errors.push(...validatePrincipal(alias, principal));
    }
  }
  return errors;
}
