// The gate, as a single import surface. The implementations live in:
//   validate-core.js      shared internals (schemas, reference checks, hole vocabulary)
//   validate-case.js      cases (+ set-level checks)
//   validate-step.js      escape-hatch steps (+ the code lint)
//   validate-template.js  invariant templates (derived schema + hole checks)
//   registries.js         steps/templates directory loaders

export { validateCase, validateCaseSet } from './validate-case.js';
export { validateStep } from './validate-step.js';
export { validateTemplate } from './validate-template.js';
export { loadSteps, loadTemplates } from './registries.js';
export { HOLE_KINDS } from './validate-core.js';
