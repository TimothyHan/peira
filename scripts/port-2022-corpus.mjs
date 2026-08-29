// One-shot generator for cases/2022-corpus/ — the 27 executable apiTestTask specs re-expressed
// in the day-one DSL (RFC 0001 §8 PR1 gate). Lineage hashes are the real sha256 of the 2022
// title text (the derive-mode section text), so PR2's mechanical hash verification can adopt
// them unchanged. The 3-6/4-6 duplicate ports once (see its `notes`), so 26 files cover 27 specs.
// Re-run with: node scripts/port-2022-corpus.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'cases', '2022-corpus');
const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

const alice = '$users.user_1';
const bob = '$users.user_2';
const submit = (code, auth = alice) => ({ request: { method: 'post', route: '/groovy/submit', auth, body: { code } } });
const submitCapture = (code, alias = 'requestId', auth = alice) => ({ ...submit(code, auth), capture: { [alias]: 'body.id' } });
const getStatus = (query, auth = alice) => ({ method: 'get', route: '/groovy/status', auth, ...(query === undefined ? {} : { query }) });
const anyString = { $any: 'string' };
const envelope = (status, error, path, message = '') => ({ error, message, path, status, timestamp: anyString });

const cases = [
  // --- auth ---
  ['auth/1-1', '1.1', 'As a user, I should be able to fetch the request detail that I created with a valid credential', {
    setup: [submitCapture('1+1 /* {{unique.nonce}} */')],
    test: {
      request: getStatus({ id: '$requestId' }),
      pollUntil: { until: { body: { status: 'COMPLETED' } } },
      expect: { status: 200, body: { id: '$requestId', result: '2', status: 'COMPLETED' } },
    },
  }],
  ['auth/1-2', '1.2', 'As a user, I should be able to submit the request with a valid credential', {
    test: { ...submit('1 + 2'), expect: { status: 200, body: { id: anyString } } },
  }],
  ['auth/1-3', '1.3', 'As a user, I should receive 401 Unauthorized when I submit the request with a invalid credential', {
    setup: [submitCapture('1+3')],
    test: {
      request: getStatus({ id: '$requestId' }, { username: 'invalid', password: 'cred' }),
      expect: { status: 401 },
    },
  }],
  ['auth/1-4', '1.4', 'As a user, I should receive 401 Unauthorized when I do not provide any credential', {
    setup: [submitCapture('1+4')],
    test: {
      request: getStatus({ id: '$requestId' }, { username: '', password: '' }),
      expect: { status: 401 },
    },
  }],
  ['auth/1-5', '1.5', 'As a user, I should receive 401 Unauthorized when I fetch the request detail that are made by other users', {
    notes: 'Ported as observed in 2022: asserts 401. Test-plan AC 1.4 says 403 — the pre-registered PR2 adjudication specimen (RFC 0001 §8).',
    setup: [submitCapture('1+5')],
    test: {
      request: getStatus({ id: '$requestId' }, bob),
      expect: { status: 401, body: envelope(401, 'Unauthorized', '/groovy/status') },
    },
  }],
  ['auth/1-6', '1.6', 'As a user, I should receive 401 Unauthorized when I submit the empty string for password', {
    setup: [submitCapture('1+5')],
    test: {
      request: getStatus({ id: '$requestId' }, { username: 'user_1', password: '' }),
      expect: { status: 401, body: envelope(401, 'Unauthorized', '/groovy/status') },
    },
  }],
  // --- submit ---
  ['submit/2-1', '2.1', 'As submit endpoint, I should respond with 400 Bad request or 422 Unprocessable Entity when the request payload is missing code field', {
    test: {
      request: { method: 'post', route: '/groovy/submit', auth: alice, body: {} },
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/submit') },
    },
  }],
  ['submit/2-2', '2.2', 'As submit endpoint, I should return 400 Bad request or 422 Unprocessable Entity when the request payload does not only contain code field and value', {
    test: {
      request: { method: 'post', route: '/groovy/submit', auth: alice, body: { code: '1 + 2', garbage: 'I should not be here' } },
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/submit') },
    },
  }],
  ['submit/2-4', '2.4', 'As submit endpoint, I should respond with 400 Bad request or 422 Unprocessable Entity when the request payload has invalid value type for code field', {
    test: {
      request: { method: 'post', route: '/groovy/submit', auth: bob, body: { code: 123 } },
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/submit') },
    },
  }],
  // --- status ---
  ['status/3-1', '3.1', 'As status endpoint, I should respond with Bad request or 422 Unprocessable Entity when the request payload has id with empty string', {
    test: {
      request: getStatus({ id: '' }),
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/status') },
    },
  }],
  ['status/3-4', '3.4', 'As status endpoint, I should return 400 Bad request or 422 Unprocessable entitity when the request payload does not only contain id field and its value', {
    test: {
      request: getStatus(undefined),
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/status') },
    },
  }],
  ['status/3-5', '3.5', 'As a service endpoint, I should respond with 404 Not found when the id does not exist in the database', {
    test: {
      request: getStatus({ id: '00000000-aaaa-1111-bbbb-222222222222' }),
      expect: { status: 404, body: envelope(404, 'Not Found', '/groovy/status') },
    },
  }],
  ['status/3-6', '3.6', 'As a service endpoint, I should respond with 404 Not found when the id is not valid', {
    notes: 'Also covers 2022 spec 4.6, its verbatim duplicate — 26 case files cover 27 executable specs.',
    test: {
      request: getStatus({ id: 'invalidRequestID' }),
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/status') },
    },
  }],
  // --- robustness: submit acceptance matrix ---
  ...[
    ['4-1-1', '4.1.1', 'As a user, I should be able to submit single line groovy code', '4+1+1'],
    ['4-1-2', '4.1.2', 'As a user, I should be able to submit multi line groovy code', 'int a = 1 + 2; ++a;'],
    ['4-1-3', '4.1.3', 'As a user, I should be able to submit loop statements', 'int start = 0; for(int i = 0; i < 10; ++i) { start++; }; start - 10;'],
    ['4-1-4', '4.1.4', 'As a user, I should be able to submit conditional statements', 'int pass = 50; if(35 < pass) { "failed"; } else {"passed";};'],
    ['4-1-5', '4.1.5', 'As a user, I should be able to submit function definition', 'def add(x,y) { return x + y;}'],
    ['4-1-6', '4.1.6', 'As a user, I should be able to submit define and run function script', 'def add(x,y) { return x + y;}; add(3,4);'],
    ['4-1-7', '4.1.7', 'As a user, I should be able to submit class definition', 'class Dog { def run() { "running" };}'],
    ['4-1-8', '4.1.8', 'As a user, I should be able to submit class definition and instantiation', 'class Dog { def run() { "running" };}; new Dog().run()'],
  ].map(([file, planId, title, code]) => [`robustness/${file}`, planId, title, {
    test: { ...submit(code), expect: { status: 200, body: { id: anyString } } },
  }]),
  ['robustness/4-2', '4.2', 'As a user, I should be able to submit the same request over and over again and receive 200 OK', {
    setup: [submit('4+2')],
    test: { ...submit('4+2'), expect: { status: 200, body: { id: anyString } } },
  }],
  ['robustness/4-3', '4.3', 'As a service, I should return 400 Bad request or 422 Unprocessable Entity with syntax/compile error message within the response body when the code has syntax error', {
    test: {
      request: { method: 'post', route: '/groovy/submit', auth: alice, body: { code: 'def wrongFunc(a { a }' } },
      expect: { status: 400, body: envelope(400, 'Bad Request', '/groovy/submit', anyString) },
    },
  }],
  ['robustness/4-4', '4.4', 'As a service, I should mark the request status as FAILED, and provide error message through result field', {
    setup: [submitCapture('somethingWrong() - 2')],
    test: {
      request: getStatus({ id: '$requestId' }),
      pollUntil: { until: { body: { status: 'FAILED' } } },
      expect: { status: 200, body: { id: '$requestId', result: anyString, status: 'FAILED' } },
    },
  }],
  ['robustness/4-5', '4.5', 'As a service, I should mark the newly accepted request as PENDING', {
    notes: 'Transient-state assertion (telemetry watchlist): deterministic against the fixture because the poll interval is pinned far below the long-job duration. teardown.drain replaces the 2022 teardown.sleep(1000).',
    setup: [
      submitCapture('sleep(1000)', 'runningIdOne'),
      submitCapture('sleep(999)', 'runningIdTwo'),
      submitCapture('4+5', 'pendingId'),
    ],
    test: {
      request: getStatus({ id: '$pendingId' }),
      pollUntil: { until: { body: { status: 'PENDING' } } },
      expect: { status: 200, body: { id: '$pendingId', result: null, status: 'PENDING' } },
    },
    teardown: { drain: true },
  }],
  // --- parallel ---
  ['parallel/5-3', '5.3', 'As a service, I should be able to handle up-to two requests at any given point', {
    notes: 'Transient-state assertion (telemetry watchlist). teardown.drain replaces the 2022 teardown.sleep(1000).',
    setup: [
      submitCapture('sleep(1000)', 'runningIdOne'),
      submitCapture('sleep(999)', 'runningIdTwo'),
      submitCapture('4+5', 'pendingId'),
    ],
    test: {
      request: getStatus({ id: '$runningIdTwo' }),
      pollUntil: { until: { body: { status: 'IN_PROGRESS' } } },
      expect: { status: 200, body: { id: '$runningIdTwo', result: null, status: 'IN_PROGRESS' } },
    },
    teardown: { drain: true },
  }],
];

let written = 0;
for (const [file, planId, title, body] of cases) {
  const caseObj = {
    id: `CASE-2022-${file.split('/')[1]}`,
    title,
    ...(body.notes ? { notes: body.notes } : {}),
    from: { intent: `2022-test-plan/${planId}`, hash: sha12(title) },
    ...(body.setup ? { setup: body.setup } : {}),
    test: body.test,
    ...(body.teardown ? { teardown: body.teardown } : {}),
  };
  const target = join(root, `${file}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(caseObj, null, 2) + '\n');
  written += 1;
}
console.log(`wrote ${written} case files under cases/2022-corpus/ (covering 27 executable 2022 specs)`);
