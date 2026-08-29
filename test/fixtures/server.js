// The validation bed (RFC 0001 §8): a zero-dep HTTP server implementing the observable
// semantics the 2022 corpus recorded — basic auth, submit/status resources, async jobs on a
// capacity-2 queue, PENDING → IN_PROGRESS → COMPLETED/FAILED, and the 2022 AUT's error
// envelope. It ships plain: deliberate behavior shifts (plants) are PR5's mechanism.
// The fixture never knows which case is calling; timing comes only from pinned constants.

import { createServer } from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import {
  FIXTURE_JOB_LONG_MS,
  FIXTURE_JOB_SHORT_MS,
  FIXTURE_QUEUE_CAPACITY,
} from '../../src/constants.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_USERS = { user_1: 'pass_1', user_2: 'pass_2' };

// --- the fixture's "groovy" semantics: just enough to honor what the corpus asserts ---

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function syntaxError(code) {
  const counts = { '(': 0, ')': 0, '{': 0, '}': 0 };
  for (const ch of stripComments(code)) if (ch in counts) counts[ch] += 1;
  if (counts['('] !== counts[')'] || counts['{'] !== counts['}']) {
    return `startup failed: unexpected token: unbalanced ${counts['('] !== counts[')'] ? 'parentheses' : 'braces'}`;
  }
  return null;
}

/** Decide a submitted script's fate: duration now, outcome at completion. */
function evaluate(code) {
  const src = stripComments(code);
  const duration = /\bsleep\(\d+\)/.test(src) ? FIXTURE_JOB_LONG_MS : FIXTURE_JOB_SHORT_MS;

  // reduce numeric `def` bindings into the expression so simple variable arithmetic
  // (including deliberate division-by-zero) evaluates the way real Groovy would
  let expr = src;
  const bindings = [];
  expr = expr.replace(/def\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;?/g, (_, name, value) => {
    bindings.push([name, value]);
    return ' ';
  });
  for (const [name, value] of bindings) expr = expr.replaceAll(new RegExp(`\\b${name}\\b`, 'g'), value);
  expr = expr.replace(/\breturn\b/g, ' ');
  if (/^[\d+\-*/%().\s]+$/.test(expr) && /\d/.test(expr)) {
    const value = Function(`"use strict"; return (${expr});`)();
    if (!Number.isFinite(value)) {
      return { duration, status: 'FAILED', result: 'java.lang.ArithmeticException: Division by zero' };
    }
    return { duration, status: 'COMPLETED', result: String(value) };
  }

  const defined = new Set(['sleep', 'if', 'for', 'while', 'switch', 'catch', 'return']);
  for (const m of src.matchAll(/(?:def|int|long|double|float|boolean|char|byte|short|String|void)\s+([A-Za-z_]\w*)\s*\(/g)) defined.add(m[1]);
  for (const m of src.matchAll(/class\s+([A-Za-z_]\w*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    if (!defined.has(m[1])) {
      return { duration, status: 'FAILED', result: `No signature of method: Script.${m[1]}() is applicable for argument types` };
    }
  }
  // a script whose final statement returns a string literal completes with that string,
  // the way real Groovy would — everything else completes with a null result
  const literal = src.trim().match(/(?:^|;|\n)\s*(?:return\s+)?'([^']*)'\s*;?\s*$/);
  return { duration, status: 'COMPLETED', result: literal ? literal[1] : null };
}

// --- server ---

export function startFixture({ port = 0, users = DEFAULT_USERS } = {}) {
  const jobs = new Map();
  let running = 0;
  const pendingQueue = [];
  const timers = new Set();

  function promote() {
    while (running < FIXTURE_QUEUE_CAPACITY && pendingQueue.length > 0) {
      const job = pendingQueue.shift();
      job.status = 'IN_PROGRESS';
      running += 1;
      const timer = setTimeout(() => {
        timers.delete(timer);
        job.status = job.outcome.status;
        job.result = job.outcome.result;
        running -= 1;
        promote();
      }, job.outcome.duration);
      timers.add(timer);
    }
  }

  function reset() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    jobs.clear();
    pendingQueue.length = 0;
    running = 0;
  }

  const envelope = (status, error, path, message = '') => ({
    error,
    message,
    path,
    status,
    timestamp: new Date().toISOString(),
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/__reset') {
        reset();
        return send(200, { reset: true });
      }

      // basic auth on everything else
      const header = req.headers.authorization ?? '';
      let username = null;
      if (header.startsWith('Basic ')) {
        const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString().split(':');
        if (users[user] !== undefined && users[user] === rest.join(':')) username = user;
      }
      if (username === null) {
        return send(401, envelope(401, 'Unauthorized', url.pathname));
      }

      if (req.method === 'POST' && url.pathname === '/groovy/submit') {
        let payload;
        try {
          payload = JSON.parse(raw || 'null');
        } catch {
          return send(400, envelope(400, 'Bad Request', url.pathname));
        }
        const keys = payload !== null && typeof payload === 'object' ? Object.keys(payload) : null;
        if (keys === null || keys.length !== 1 || keys[0] !== 'code' || typeof payload.code !== 'string') {
          return send(400, envelope(400, 'Bad Request', url.pathname));
        }
        const syntax = syntaxError(payload.code);
        if (syntax !== null) {
          return send(400, envelope(400, 'Bad Request', url.pathname, syntax));
        }
        const job = { id: randomUUID(), owner: username, status: 'PENDING', result: null, outcome: evaluate(payload.code) };
        jobs.set(job.id, job);
        pendingQueue.push(job);
        promote();
        return send(200, { id: job.id });
      }

      // PR3's exclusive plant: an endpoint no day-one primitive can drive — the signature must
      // be computed. Shared demo secret is stated in the intent; principal passwords are never
      // signing keys. No 2022-corpus route or behavior is touched.
      if (req.method === 'POST' && url.pathname === '/secure/echo') {
        let payload;
        try {
          payload = JSON.parse(raw || 'null');
        } catch {
          return send(400, envelope(400, 'Bad Request', url.pathname));
        }
        const keys = payload !== null && typeof payload === 'object' ? Object.keys(payload).sort() : null;
        if (keys === null || keys.join(',') !== 'payload,signature' || typeof payload.payload !== 'string' || typeof payload.signature !== 'string') {
          return send(400, envelope(400, 'Bad Request', url.pathname));
        }
        const expected = createHmac('sha256', 'peira-demo-secret').update(payload.payload).digest('hex');
        if (payload.signature !== expected) {
          return send(400, envelope(400, 'Bad Request', url.pathname, 'invalid signature'));
        }
        return send(200, { echo: payload.payload, verified: true });
      }

      if (req.method === 'GET' && url.pathname === '/groovy/status') {
        if (!url.searchParams.has('id')) return send(400, envelope(400, 'Bad Request', url.pathname));
        const id = url.searchParams.get('id');
        if (!UUID.test(id)) return send(400, envelope(400, 'Bad Request', url.pathname));
        const job = jobs.get(id);
        if (!job) return send(404, envelope(404, 'Not Found', url.pathname));
        if (job.owner !== username) return send(401, envelope(401, 'Unauthorized', url.pathname));
        return send(200, { id: job.id, status: job.status, result: job.result });
      }

      return send(404, envelope(404, 'Not Found', url.pathname));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        reset,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// CLI: `node test/fixtures/server.js [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startFixture({ port: Number(process.argv[2] ?? 4477) });
  console.log(`peira fixture listening on ${url}`);
}
