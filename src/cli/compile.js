import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadIntentDir, lintIntent } from '../intent.js';
import { loadSteps } from '../validate.js';
import { compileSections } from '../compile.js';
import { claudeCliTransport } from '../llm.js';
import { COMPILE_MODEL } from '../constants.js';

export async function main(ctx) {
  const { flags, positionals, bed } = ctx;
  if (!flags.out) {
    console.error('peira compile needs --out <dir>');
    return 2;
  }
  const intentDir = positionals[0] ?? 'intent';
  const allSections = loadIntentDir(intentDir);
  if (allSections.length === 0) {
    console.error(`no intent sections found in ${intentDir} — every "##" heading with body text becomes a section.`);
    console.error('an unstructured document can be restructured once with: peira adopt <file> --out <intent/name.md>');
    return 1;
  }
  // advisory only — the tool teaches the adopt workflow, it never normalizes uninvited
  const lintWarnings = lintIntent(allSections);
  for (const msg of lintWarnings) console.error(`warn  intent: ${msg}`);
  if (lintWarnings.length > 0) {
    console.error('warn  intent: coarse or fragile sections compile, but lineage suffers — consider the one-time `peira adopt` (you review and own the result)');
  }
  const fullDocument = allSections.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n');
  let sections = allSections;
  if (flags.section?.length) {
    const wanted = new Set(flags.section);
    sections = allSections.filter((s) => wanted.has(s.id));
    const known = new Set(allSections.map((s) => s.id));
    for (const id of wanted) {
      if (!known.has(id)) {
        console.error(`no intent section "${id}" — known: ${[...known].join(', ')}`);
        return 2;
      }
    }
  }

  const stepsDir = flags.steps ?? join(flags.out, 'steps');
  const templatesDir = flags.templates ?? join(flags.out, 'templates');
  const { steps: existingSteps } = loadSteps(stepsDir);
  const { accepted, acceptedSteps, acceptedTemplates, manifest } = await compileSections(sections, {
    llm: claudeCliTransport(),
    bedUsers: bed?.users,
    steps: existingSteps,
    fullDocument,
    model: COMPILE_MODEL,
    onProgress: (msg) => console.error(msg),
  });

  mkdirSync(flags.out, { recursive: true });
  const manifestPath = join(flags.out, 'compile-manifest.json');
  const finalManifest = mergeManifest({ manifest, manifestPath, sections, flags, out: flags.out, stepsDir, templatesDir });

  for (const { caseObj } of accepted) {
    writeFileSync(join(flags.out, `${caseObj.id}.json`), JSON.stringify(caseObj, null, 2) + '\n');
  }
  if (acceptedSteps.length > 0) mkdirSync(stepsDir, { recursive: true });
  for (const { stepObj } of acceptedSteps) {
    writeFileSync(join(stepsDir, `${stepObj.id}.json`), JSON.stringify(stepObj, null, 2) + '\n');
  }
  if (acceptedTemplates.length > 0) mkdirSync(templatesDir, { recursive: true });
  for (const { tplObj } of acceptedTemplates) {
    writeFileSync(join(templatesDir, `${tplObj.id}.json`), JSON.stringify(tplObj, null, 2) + '\n');
  }
  writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2) + '\n');

  const outcomes = manifest.sections.reduce((acc, s) => ((acc[s.outcome] = (acc[s.outcome] ?? 0) + 1), acc), {});
  const extras = [
    acceptedSteps.length > 0 ? `${acceptedSteps.length} step(s)` : null,
    acceptedTemplates.length > 0 ? `${acceptedTemplates.length} template(s)` : null,
  ].filter(Boolean).map((s) => ` + ${s}`).join('');
  console.log(`compiled ${accepted.length} case(s)${extras} from ${sections.length} section(s) → ${flags.out}`);
  console.log(`sections: ${JSON.stringify(outcomes)} | manifest: ${manifestPath}`);
  return manifest.sections.some((s) => s.outcome === 'transport-error') ? 1 : 0;
}

/** Targeted recompile: merge into the existing manifest, remove superseded artifact files. */
function mergeManifest({ manifest, manifestPath, sections, flags, out, stepsDir, templatesDir }) {
  if (!flags.section?.length) return manifest;
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return manifest; // no prior manifest — a targeted compile into a fresh dir is just a small full compile
  }
  const recompiled = new Set(sections.map((s) => s.id));
  for (const entry of previous.sections.filter((s) => recompiled.has(s.id))) {
    for (const staleId of entry.cases ?? []) rmSync(join(out, `${staleId}.json`), { force: true });
    for (const staleStep of entry.steps ?? []) rmSync(join(stepsDir, `${staleStep}.json`), { force: true });
    for (const staleTpl of entry.templates ?? []) rmSync(join(templatesDir, `${staleTpl}.json`), { force: true });
  }
  return {
    ...previous,
    model: manifest.model,
    contractHash: manifest.contractHash,
    sections: previous.sections.map((entry) => (recompiled.has(entry.id) ? manifest.sections.find((s) => s.id === entry.id) : entry)),
  };
}
