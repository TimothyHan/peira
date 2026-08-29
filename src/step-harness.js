// Child-process step harness (RFC 0001 §4.5). One process per invocation: read
// {code, inputs, baseUrl} from stdin, run the generated function with exactly two things in
// scope — its inputs and the ctx helpers — write {ok, outputs | error, kind} to stdout, exit.
// This is isolation by contract and review; the process boundary reduces blast radius, it is
// not a security boundary (and the design says so).
//
// ctx helpers available to step code:
//   ctx.aut({method, route, query, body, auth})  — HTTP to the AUT base URL only
//   ctx.crypto                                    — {createHmac, createHash, randomUUID}

import { createHmac, createHash, randomUUID } from 'node:crypto';
import { httpRequest, InfraError } from './http.js';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', async () => {
  const reply = (obj) => {
    process.stdout.write(JSON.stringify(obj));
    process.exit(0);
  };
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    return reply({ ok: false, kind: 'contract', error: 'harness received invalid JSON' });
  }

  const ctx = {
    crypto: { createHmac, createHash, randomUUID },
    aut: async (opts) => {
      try {
        return await httpRequest({ ...opts, baseUrl: job.baseUrl });
      } catch (err) {
        if (err instanceof InfraError) {
          err.isInfra = true; // tag so the catch below can classify without instanceof across scopes
        }
        throw err;
      }
    },
  };

  try {
    const fn = new (Object.getPrototypeOf(async function () {}).constructor)('inputs', 'ctx', job.code);
    const outputs = await fn(job.inputs, ctx);
    if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) {
      return reply({ ok: false, kind: 'contract', error: 'step code must return an object of produced values' });
    }
    return reply({ ok: true, outputs });
  } catch (err) {
    return reply({ ok: false, kind: err?.isInfra ? 'infra' : 'step', error: String(err?.message ?? err) });
  }
});
