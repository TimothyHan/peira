// Endpoint coverage against an OpenAPI document (`peira stats --openapi <spec.json>`).
// OpenAPI stays an OPTIONAL input (decided 2026-08-27): nothing requires it, and this report
// only exists when one is offered. It answers the question `stats` alone cannot: which
// endpoints of the declared API surface have no case exercising them?

import type { LoadedCase } from './types.js';

export const CASE_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

export interface Endpoint {
  method: string;
  /** OpenAPI path template, e.g. /orders/{id}/cancel */
  path: string;
}

export interface CoverageReport {
  endpoints: number;
  covered: Array<Endpoint & { cases: string[] }>;
  untested: Endpoint[];
  /** case requests that matched no endpoint in the document */
  unmatched: Array<{ method: string; route: string; cases: string[] }>;
}

/**
 * Extract the testable endpoints from a parsed OpenAPI document. Only the methods the case
 * DSL can express are reported — an endpoint Peira cannot state is not "untested", it is out
 * of scope. Throws on a document without a `paths` object.
 */
export function readOpenApiEndpoints(doc: unknown): Endpoint[] {
  const paths = (doc as { paths?: Record<string, unknown> } | null)?.paths;
  if (paths === undefined || paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new Error('not an OpenAPI document: no "paths" object (JSON only — convert YAML specs first)');
  }
  const endpoints: Endpoint[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (item === null || typeof item !== 'object') continue;
    for (const method of CASE_METHODS) {
      if (method in (item as Record<string, unknown>)) endpoints.push({ method, path });
    }
  }
  return endpoints;
}

/**
 * Does a case route (possibly carrying `$capture` / `{{token}}` segments) hit an OpenAPI path
 * template? Segment-wise: a `{param}` template segment matches any case segment; a literal
 * template segment matches only itself — a runtime token can never match a literal, because
 * its value is unknowable statically.
 */
export function routeMatches(template: string, route: string): boolean {
  const stripQuery = route.split('?')[0];
  const tSegs = template.split('/').filter((s) => s !== '');
  const rSegs = stripQuery.split('/').filter((s) => s !== '');
  if (tSegs.length !== rSegs.length) return false;
  return tSegs.every((tSeg, i) => (/^\{.+\}$/.test(tSeg) ? true : tSeg === rSegs[i]));
}

function caseRequests(loaded: LoadedCase[]): Array<{ method: string; route: string; caseId: string }> {
  const requests: Array<{ method: string; route: string; caseId: string }> = [];
  for (const { caseObj } of loaded) {
    const blocks = [...((caseObj.setup ?? []) as Record<string, any>[]), caseObj.test as Record<string, any>];
    for (const block of blocks) {
      if ('step' in block) continue; // registry steps run arbitrary code — not attributable to a route
      const req = block.request;
      if (req?.method && req?.route) requests.push({ method: req.method, route: req.route, caseId: caseObj.id });
    }
  }
  return requests;
}

/** Compare a case set against an API surface. */
export function computeCoverage(loaded: LoadedCase[], endpoints: Endpoint[]): CoverageReport {
  const requests = caseRequests(loaded);
  const covered: Array<Endpoint & { cases: string[] }> = [];
  const untested: Endpoint[] = [];
  const matchedRequests = new Set<number>();

  for (const ep of endpoints) {
    const cases = new Set<string>();
    requests.forEach((req, i) => {
      if (req.method === ep.method && routeMatches(ep.path, req.route)) {
        cases.add(req.caseId);
        matchedRequests.add(i);
      }
    });
    if (cases.size > 0) covered.push({ ...ep, cases: [...cases].sort() });
    else untested.push(ep);
  }

  const unmatchedMap = new Map<string, Set<string>>();
  requests.forEach((req, i) => {
    if (matchedRequests.has(i)) return;
    const key = `${req.method} ${req.route}`;
    if (!unmatchedMap.has(key)) unmatchedMap.set(key, new Set());
    unmatchedMap.get(key)!.add(req.caseId);
  });
  const unmatched = [...unmatchedMap.entries()].map(([key, cases]) => {
    const [method, route] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
    return { method, route, cases: [...cases].sort() };
  });

  return { endpoints: endpoints.length, covered, untested, unmatched };
}

export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  const pct = report.endpoints === 0 ? 100 : (report.covered.length / report.endpoints) * 100;
  lines.push(`endpoint coverage: ${report.covered.length}/${report.endpoints} (${pct.toFixed(1)}%)`);
  if (report.untested.length > 0) {
    lines.push('');
    lines.push('untested endpoints (no case sends this request):');
    for (const ep of report.untested) lines.push(`  ${ep.method.toUpperCase().padEnd(6)} ${ep.path}`);
  }
  if (report.unmatched.length > 0) {
    lines.push('');
    lines.push('case requests outside the document (drift, or the spec is incomplete):');
    for (const u of report.unmatched) {
      lines.push(`  ${u.method.toUpperCase().padEnd(6)} ${u.route}  (${u.cases.join(', ')})`);
    }
  }
  return lines.join('\n');
}
