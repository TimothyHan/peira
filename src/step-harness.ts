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
import { httpRequest, InfraError, type HttpRequestOptions } from './http.js';

interface HarnessJob {
  code: string;
  inputs: Record<string, unknown>;
  baseUrl: string;
}

export type HarnessResult =
  | { ok: true; outputs: Record<string, unknown> }
  | { ok: false; kind: 'contract' | 'infra' | 'step'; error: string };

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', async () => {
  const reply = (obj: HarnessResult): void => {
    process.stdout.write(JSON.stringify(obj));
    process.exit(0);
  };
  let job: HarnessJob;
  try {
    job = JSON.parse(raw);
  } catch {
    return reply({ ok: false, kind: 'contract', error: 'harness received invalid JSON' });
  }

  const ctx = {
    crypto: { createHmac, createHash, randomUUID },
    aut: async (opts: Omit<HttpRequestOptions, 'baseUrl'>) => {
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
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (inputs: unknown, ctx: unknown) => Promise<unknown>;
    const fn = new AsyncFunction('inputs', 'ctx', job.code);
    const outputs = await fn(job.inputs, ctx);
    if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) {
      return reply({ ok: false, kind: 'contract', error: 'step code must return an object of produced values' });
    }
    return reply({ ok: true, outputs: outputs as Record<string, unknown> });
  } catch (err) {
    const e = err as { isInfra?: boolean; message?: string };
    return reply({ ok: false, kind: e?.isInfra ? 'infra' : 'step', error: String(e?.message ?? err) });
  }
});
