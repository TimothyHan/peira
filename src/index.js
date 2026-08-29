// Peira's public programmatic API. The CLI (bin/peira.js) is a thin layer over exactly this.

export { runCases, runCase, uniqueValue, runHarness } from './runner.js';
export { validateCase, validateCaseSet, validateStep, validateTemplate, loadSteps, loadTemplates, HOLE_KINDS } from './validate.js';
export { loadCases, listCaseFiles } from './load.js';
export { parseIntent, loadIntentDir, hashSection, normalizeText } from './intent.js';
export { checkStale } from './stale.js';
export { compileSections, buildContract, buildPrompt } from './compile.js';
export { claudeCliTransport } from './llm.js';
export { triageRun, parseEvidence, routeVerdicts, gateTriageOutput } from './triage.js';
export { deriveAkelaEvidence } from './akela.js';
export { computeStats, formatStats, shapeSignature, codeSkeleton } from './stats.js';
export { mintCase, mintAll, drawHoles, prng } from './generate.js';
export { matchSubset, matchExpect, ANY_TYPES } from './expect.js';
export { resolveValue, findTokens } from './interpolate.js';
export { validateSchema } from './schema.js';
export { httpRequest } from './http.js';
export { EvidenceLog, deepRedact, redactValue } from './evidence.js';
export { extractJsonObject } from './model-output.js';
export { CaseFailure, InfraError, TransportError, UnresolvedTokenError } from './errors.js';
export * as constants from './constants.js';
