// Artifact registries: steps and templates load from directories into Maps, each entry
// passing its gate on the way in. Invalid entries are reported, never partially loaded.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateStep } from './validate-step.js';
import { validateTemplate, type TemplateValidationOptions } from './validate-template.js';
import type { StepDef, Template } from './types.js';

export interface RegistryResult {
  file: string;
  id: string | null;
  errors: string[];
}

function loadRegistry<T extends { id: string }>(
  dir: string | null,
  validate: (obj: unknown) => { errors: string[] },
  label: string,
): { registry: Map<string, T>; results: RegistryResult[] } {
  const registry = new Map<string, T>();
  const results: RegistryResult[] = [];
  if (!dir || !existsSync(dir)) return { registry, results };
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const file = join(dir, entry);
    let obj: T | undefined;
    try {
      obj = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      results.push({ file, id: null, errors: [`not valid JSON — ${(err as Error).message}`] });
      continue;
    }
    const { errors } = validate(obj);
    if (obj?.id && registry.has(obj.id)) errors.push(`duplicate ${label} id ${obj.id}`);
    if (errors.length === 0 && obj) registry.set(obj.id, obj);
    results.push({ file, id: obj?.id ?? null, errors });
  }
  return { registry, results };
}

/** Load a steps directory. Returns { steps: Map, results: [{file, id, errors}] }. */
export function loadSteps(dir: string | null): { steps: Map<string, StepDef>; results: RegistryResult[] } {
  const { registry, results } = loadRegistry<StepDef>(dir, validateStep, 'step');
  return { steps: registry, results };
}

/** Load a templates directory. Returns { templates: Map, results: [{file, id, errors}] }. */
export function loadTemplates(
  dir: string | null,
  opts: TemplateValidationOptions = {},
): { templates: Map<string, Template>; results: RegistryResult[] } {
  const { registry, results } = loadRegistry<Template>(dir, (obj) => validateTemplate(obj, opts), 'template');
  return { templates: registry, results };
}
