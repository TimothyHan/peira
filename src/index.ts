// Peira's public programmatic API. The CLI (bin/peira.js) is a thin layer over exactly this.

export { runCases, runCase, uniqueValue, runHarness } from './runner.js';
export { validateCase, validateCaseSet, validateStep, validateTemplate, loadSteps, loadTemplates, HOLE_KINDS } from './validate.js';
export { loadCases, listCaseFiles } from './load.js';
export { parseIntent, loadIntentDir, hashSection, normalizeText, lintIntent } from './intent.js';
export { adoptDocument, gateAdoptedDocument, buildAdoptPrompt } from './adopt.js';
export { checkStale } from './stale.js';
export { compileSections, buildContract, buildPrompt } from './compile.js';
export { claudeCliTransport } from './llm.js';
export { triageRun, parseEvidence, routeVerdicts, gateTriageOutput } from './triage.js';
export { deriveLedgerEvidence, sectionEvidence } from './ledger.js';
export { ensureLedgerConfig, recordRun, runEngine, engineBin, outcomeStatus, LEDGER_ENGINE_CONFIG, LedgerError } from './ledger-engine.js';
export { computeStats, formatStats, shapeSignature, codeSkeleton } from './stats.js';
export { junitXml } from './report-junit.js';
export { readOpenApiEndpoints, computeCoverage, formatCoverage, routeMatches, CASE_METHODS } from './coverage.js';
export { renderDocument, renderCase } from './render.js';
export { mintCase, mintAll, drawHoles, prng } from './generate.js';
export { matchSubset, matchExpect, ANY_TYPES } from './expect.js';
export { resolveValue, findTokens } from './interpolate.js';
export { validateSchema } from './schema.js';
export { httpRequest } from './http.js';
export { EvidenceLog, deepRedact, redactValue } from './evidence.js';
export { extractJsonObject } from './model-output.js';
export { CaseFailure, InfraError, TransportError, UnresolvedTokenError } from './errors.js';
export * as constants from './constants.js';

// The public type surface (structural mirrors of the JSON-schema-gated artifacts).
export type { VerdictKind, Diff, Verdict, Principal, BasicPrincipal, LoginPrincipal, StaticTokenPrincipal, TokenSend, BedConfig, Case, CaseLineage, LoadedCase, VerdictCounts, RunResult, StepDef, Template, HoleDecl } from './types.js';
export type { IntentSection, IntentKind } from './intent.js';
export type { HttpRequestOptions, HttpResponse } from './http.js';
export type { CompileManifest, ManifestEntry, CompileOptions, CompileResult } from './compile.js';
export type { TriageProposals, TriageVerdict, ParsedEvidence, EvidenceEvent } from './triage.js';
export type { GatedAdoption, AdoptionReport } from './adopt.js';
export type { LedgerRecord, SectionEvidence } from './ledger.js';
export type { RenderDocumentOptions, ReportModel } from './render.js';
export type { Stats } from './stats.js';
export type { Endpoint, CoverageReport } from './coverage.js';
export type { SchemaError, JsonSchema } from './schema.js';
export { validateBed, validatePrincipal } from './validate-bed.js';
export { SecretRegistry } from './evidence.js';
export { planStamp, applyStamp } from './stamp.js';
export type { StampPlan, StampChange } from './stamp.js';
