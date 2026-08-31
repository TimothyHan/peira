// The validation bed (RFC 0001 §8): a zero-dep HTTP server implementing the observable
// semantics the 2022 corpus recorded — basic auth, submit/status resources, async jobs on a
// capacity-2 queue, PENDING → IN_PROGRESS → COMPLETED/FAILED, the 2022 AUT's error envelope,
// and PR3's exclusive /secure/echo plant.
//
// PR5 adds the plant mechanism: `startFixture({ plant })` activates ONE pre-registered
// behavior shift from test/fixtures/plants.js (id string or flags object). No plant → the
// fixture behaves byte-identically to its unplanted self (regression-tested); the fixture
// still never knows which case is calling. Timing comes only from pinned constants.

import { createServer } from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import {
  FIXTURE_JOB_LONG_MS,
  FIXTURE_JOB_SHORT_MS,
  FIXTURE_QUEUE_CAPACITY,
} from '../../dist/constants.js';
import { PLANTS } from './plants.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_USERS = { user_1: 'pass_1', user_2: 'pass_2' };

// --- the fixture's "groovy" semantics: just enough to honor what the corpus asserts ---

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function syntaxError(code) {
  const src = stripComments(code);
  const counts = { '(': 0, ')': 0, '{': 0, '}': 0 };
  for (const ch of src) if (ch in counts) counts[ch] += 1;
  if (counts['('] !== counts[')'] || counts['{'] !== counts['}']) {
    return `startup failed: unexpected token: unbalanced ${counts['('] !== counts[')'] ? 'parentheses' : 'braces'}`;
  }
  // a declaration with no right-hand side ("def x =") is a real Groovy syntax error; the bed
  // used to accept it with 200, which is a wrong answer rather than a missing one
  if (/\b(?:def|int|long|double|float|boolean|char|byte|short|String)\s+[A-Za-z_]\w*\s*=\s*(?:;|\n|$)/.test(src)) {
    return 'startup failed: unexpected token: expression expected after "="';
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

  // an explicit throw fails with its own message, the way the real runner reported it —
  // without this the unknown-method scan below claims RuntimeException() does not exist
  const thrown = src.match(/\bthrow\s+new\s+([A-Za-z_][\w.]*)\s*\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/);
  if (thrown) {
    const type = thrown[1].includes('.') ? thrown[1] : `java.lang.${thrown[1]}`;
    const message = thrown[2] ?? thrown[3];
    return { duration, status: 'FAILED', result: message ? `${type}: ${message}` : type };
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

export function startFixture({ port = 0, users = DEFAULT_USERS, plant = null } = {}) {
  const flags = typeof plant === 'string' ? (PLANTS[plant]?.flags ?? (() => { throw new Error(`unknown plant "${plant}"`); })()) : (plant ?? {});
  const jobs = new Map();
  let running = 0;
  let requestCount = 0;
  const pendingQueue = [];
  const timers = new Set();
  const capacity = flags.capacity ?? FIXTURE_QUEUE_CAPACITY;

  function promote() {
    while (running < capacity && pendingQueue.length > 0) {
      const job = pendingQueue.shift();
      job.status = 'IN_PROGRESS';
      running += 1;
      const timer = setTimeout(() => {
        timers.delete(timer);
        job.status = flags.failedCompleted && job.outcome.status === 'FAILED' ? 'COMPLETED' : job.outcome.status;
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
    requestCount = 0;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    const envelope = (status, error, message = '') => {
      const body = {
        error: flags.labelMap?.[error] ?? error,
        message: message === '' && flags.envelopeMessage ? flags.envelopeMessage : message,
        path: flags.pathWithQuery && url.search ? url.pathname + url.search : url.pathname,
        status: flags.envelopeStatusString ? String(status) : status,
        timestamp: flags.timestampNumeric ? Date.now() : new Date().toISOString(),
      };
      if (flags.dropEnvelopeField) delete body[flags.dropEnvelopeField];
      return body;
    };

    const send = (status, body) => {
      const mapped = flags.routeStatus?.[url.pathname]?.[status] ?? status;
      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        for (const r of flags.rename ?? []) {
          if (r.route === url.pathname && r.from in body) {
            body[r.to] = body[r.from];
            delete body[r.from];
          }
        }
        for (const d of flags.drop ?? []) {
          if (d.route === url.pathname) delete body[d.field];
        }
      }
      res.writeHead(mapped, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/__reset') {
        reset();
        return send(200, { reset: true });
      }

      // nondeterministic-fault plants fire before anything else
      requestCount += 1;
      const n = flags.failEveryN;
      if ((n && (!n.route || n.route === url.pathname) && requestCount % n.n === 0) ||
          (flags.failFirstN && requestCount <= flags.failFirstN) ||
          (flags.failProb && (!flags.failProb.route || flags.failProb.route === url.pathname) && Math.random() < flags.failProb.p)) {
        return send(500, envelope(500, 'Internal Server Error'));
      }

      // basic auth on everything else
      const header = req.headers.authorization ?? '';
      let username = null;
      if (header.startsWith('Basic ')) {
        const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString().split(':');
        if (users[user] !== undefined && (users[user] === rest.join(':') || flags.authAcceptAny)) username = user;
        if (username === null && flags.anonAccept && user === '') username = Object.keys(users)[0];
      } else if (flags.anonAccept) {
        username = Object.keys(users)[0];
      }
      if (username === null) {
        return send(401, envelope(401, 'Unauthorized'));
      }

      if (req.method === 'POST' && url.pathname === '/groovy/submit') {
        let payload;
        try {
          payload = JSON.parse(raw || 'null');
        } catch {
          return send(400, envelope(400, 'Bad Request'));
        }
        const isObj = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
        const keys = isObj ? Object.keys(payload) : null;
        const shapeOk =
          (keys !== null && keys.length === 1 && keys[0] === 'code' && typeof payload.code === 'string') ||
          (flags.acceptInvalidSubmit === 'empty' && keys !== null && keys.length === 0) ||
          (flags.acceptInvalidSubmit === 'garbage' && keys !== null && keys.includes('code') && typeof payload.code === 'string') ||
          (flags.acceptInvalidSubmit === 'numeric' && keys !== null && keys.length === 1 && keys[0] === 'code');
        if (!shapeOk) {
          return send(400, envelope(400, 'Bad Request'));
        }
        const code = String(payload.code ?? '');
        const syntax = syntaxError(code);
        if (syntax !== null && flags.acceptInvalidSubmit !== 'syntax') {
          return send(400, envelope(400, 'Bad Request', syntax));
        }
        const job = { id: randomUUID(), owner: username, status: 'PENDING', result: null, outcome: evaluate(code) };
        jobs.set(job.id, job);
        pendingQueue.push(job);
        promote();
        return send(200, { id: job.id });
      }

      if (req.method === 'POST' && url.pathname === '/secure/echo') {
        let payload;
        try {
          payload = JSON.parse(raw || 'null');
        } catch {
          return send(400, envelope(400, 'Bad Request'));
        }
        const keys = payload !== null && typeof payload === 'object' ? Object.keys(payload).sort() : null;
        if (keys === null || keys.join(',') !== 'payload,signature' || typeof payload.payload !== 'string' || typeof payload.signature !== 'string') {
          return send(400, envelope(400, 'Bad Request'));
        }
        const expected = createHmac('sha256', 'peira-demo-secret').update(payload.payload).digest('hex');
        if (payload.signature !== expected) {
          return send(400, envelope(400, 'Bad Request', 'invalid signature'));
        }
        return send(200, { echo: payload.payload, verified: true });
      }

      if (req.method === 'GET' && url.pathname === '/groovy/status') {
        if (!url.searchParams.has('id')) return send(400, envelope(400, 'Bad Request'));
        const id = url.searchParams.get('id');
        if (!UUID.test(id)) {
          return flags.invalidId500
            ? send(500, envelope(500, 'Internal Server Error'))
            : send(400, envelope(400, 'Bad Request'));
        }
        const job = jobs.get(id);
        if (!job) {
          return flags.unknownId200
            ? send(200, { id, status: 'PENDING', result: null })
            : send(404, envelope(404, 'Not Found'));
        }
        if (job.owner !== username && !flags.crossUser200) return send(401, envelope(401, 'Unauthorized'));
        let status = flags.stuckPending ? 'PENDING' : job.status;
        status = flags.statusLabelMap?.[status] ?? status;
        const result = flags.stuckPending || (flags.resultNull && job.status === 'COMPLETED') ? null : job.result;
        return send(200, { id: job.id, status, result });
      }

      return send(404, envelope(404, 'Not Found'));
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

// CLI: `node test/fixtures/server.js [port] [--plant <shift-id>]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const plantIdx = process.argv.indexOf('--plant');
  const plant = plantIdx !== -1 ? process.argv[plantIdx + 1] : null;
  const portArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const { url } = await startFixture({ port: Number(portArg ?? 4477), plant });
  console.log(`peira fixture listening on ${url}${plant ? ` [plant: ${plant}]` : ''}`);
}
