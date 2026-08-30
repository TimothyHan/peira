import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOpenApiEndpoints, computeCoverage, routeMatches, formatCoverage } from '../dist/coverage.js';
import { makeCase } from './helpers.js';

const doc = {
  openapi: '3.0.0',
  paths: {
    '/orders': { post: {}, get: {} },
    '/orders/{id}/cancel': { post: {} },
    '/orders/{id}': { get: {}, head: {} }, // head is outside the case DSL's method enum
  },
};

test('readOpenApiEndpoints: only DSL-expressible methods, throws on a non-OpenAPI document', () => {
  const endpoints = readOpenApiEndpoints(doc);
  assert.deepEqual(
    endpoints.map((e) => `${e.method} ${e.path}`).sort(),
    ['get /orders', 'get /orders/{id}', 'post /orders', 'post /orders/{id}/cancel'],
  );
  assert.throws(() => readOpenApiEndpoints({ not: 'a spec' }), /paths/);
});

test('routeMatches: {param} segments match anything, literals match only themselves', () => {
  assert.ok(routeMatches('/orders/{id}/cancel', '/orders/$orderId/cancel'));
  assert.ok(routeMatches('/orders/{id}', '/orders/123'));
  assert.ok(!routeMatches('/orders/{id}/cancel', '/orders/$orderId/refund'));
  assert.ok(!routeMatches('/orders/{id}', '/orders/123/cancel')); // segment count differs
  assert.ok(!routeMatches('/orders/cancel', '/orders/$token')); // a token never matches a literal
});

test('computeCoverage: untested endpoints named, setup requests count, unmatched requests reported', () => {
  const c = makeCase({
    id: 'CASE-cancel',
    setup: [{ request: { method: 'post', route: '/orders' }, capture: { orderId: 'body.id' } }],
    test: { request: { method: 'post', route: '/orders/$orderId/cancel' }, expect: { status: 409 } },
  });
  const stray = makeCase({
    id: 'CASE-stray',
    test: { request: { method: 'get', route: '/not-in-spec' }, expect: { status: 200 } },
  });
  const report = computeCoverage(
    [{ file: 'a', caseObj: c }, { file: 'b', caseObj: stray }],
    readOpenApiEndpoints(doc),
  );
  assert.equal(report.endpoints, 4);
  assert.deepEqual(report.untested.map((e) => `${e.method} ${e.path}`).sort(), ['get /orders', 'get /orders/{id}']);
  const cancel = report.covered.find((e) => e.path === '/orders/{id}/cancel');
  assert.deepEqual(cancel.cases, ['CASE-cancel']);
  assert.deepEqual(report.unmatched, [{ method: 'get', route: '/not-in-spec', cases: ['CASE-stray'] }]);

  const text = formatCoverage(report);
  assert.match(text, /endpoint coverage: 2\/4 \(50.0%\)/);
  assert.match(text, /untested endpoints/);
  assert.match(text, /GET\s+\/orders\/\{id\}/);
  assert.match(text, /outside the document/);
});

test('an empty document surface is 100% covered by definition', () => {
  const report = computeCoverage([], []);
  assert.match(formatCoverage(report), /0\/0 \(100.0%\)/);
});
