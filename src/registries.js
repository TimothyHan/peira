// Artifact registries: steps and templates load from directories into Maps, each entry
// passing its gate on the way in. Invalid entries are reported, never partially loaded.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateStep } from './validate-step.js';
import { validateTemplate } from './validate-template.js';

function loadRegistry(dir, validate, label) {
  const registry = new Map();
  const results = [];
  if (!dir || !existsSync(dir)) return { registry, results };
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const file = join(dir, entry);
    let obj;
    try {
      obj = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      results.push({ file, id: null, errors: [`not valid JSON — ${err.message}`] });
      continue;
    }
    const { errors } = validate(obj);
    if (obj?.id && registry.has(obj.id)) errors.push(`duplicate ${label} id ${obj.id}`);
    if (errors.length === 0) registry.set(obj.id, obj);
    results.push({ file, id: obj?.id ?? null, errors });
  }
  return { registry, results };
}

/** Load a steps directory. Returns { steps: Map, results: [{file, id, errors}] }. */
export function loadSteps(dir) {
  const { registry, results } = loadRegistry(dir, validateStep, 'step');
  return { steps: registry, results };
}

/** Load a templates directory. Returns { templates: Map, results: [{file, id, errors}] }. */
export function loadTemplates(dir, opts = {}) {
  const { registry, results } = loadRegistry(dir, (obj) => validateTemplate(obj, opts), 'template');
  return { templates: registry, results };
}
