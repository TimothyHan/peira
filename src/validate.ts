// The gate, as a single import surface. The implementations live in:
//   validate-core.ts      shared internals (schemas, reference checks, hole vocabulary)
//   validate-case.ts      cases (+ set-level checks)
//   validate-step.ts      escape-hatch steps (+ the code lint)
//   validate-template.ts  invariant templates (derived schema + hole checks)
//   registries.ts         steps/templates directory loaders

export { validateCase, validateCaseSet } from './validate-case.js';
export type { CaseValidationOptions, CaseValidationResult } from './validate-case.js';
export { validateStep } from './validate-step.js';
export { validateTemplate } from './validate-template.js';
export type { TemplateValidationOptions } from './validate-template.js';
export { loadSteps, loadTemplates } from './registries.js';
export type { RegistryResult } from './registries.js';
export { HOLE_KINDS } from './validate-core.js';
