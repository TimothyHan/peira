// Seeded generators + template instantiation (RFC 0001 §4.4). Every draw is a pure function of
// (seed, template id, instance index) — no shared RNG stream, so instances are independent of
// run order and of each other, and any minted case regenerates bit-for-bit from its coordinates.

import { createHash } from 'node:crypto';
import { INVARIANT_CASES_PER_RUN } from './constants.js';

/** Deterministic PRNG (mulberry32 over a sha256-derived state). Returns () => [0, 1). */
export function prng(material) {
  const digest = createHash('sha256').update(material).digest();
  let a = digest.readUInt32LE(0) ^ digest.readUInt32LE(8);
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw concrete values for every hole. Declaration order matters only for distinctFrom. */
export function drawHoles(template, { bedUsers, seed, index }) {
  const rng = prng(`${seed}|${template.id}|${index}`);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const values = {};
  for (const [name, decl] of Object.entries(template.holes)) {
    if (decl.kind === 'principal') {
      let pool = Object.keys(bedUsers).sort();
      if (decl.distinctFrom) pool = pool.filter((alias) => `$users.${alias}` !== values[decl.distinctFrom].ref);
      values[name] = { ref: `$users.${pick(pool)}` };
    } else if (decl.kind === 'expression') {
      // arithmetic with a KNOWN result — the oracle asserts the exact answer
      const a = 2 + Math.floor(rng() * 96);
      const b = 2 + Math.floor(rng() * 96);
      const op = pick(['+', '-', '*']);
      const result = op === '+' ? a + b : op === '-' ? a - b : a * b;
      values[name] = { code: `${a} ${op} ${b}`, result: String(result) };
    } else {
      values[name] = { value: 'g' + Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0') };
    }
  }
  return values;
}

const WHOLE_HOLE = /^\$holes\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/;
const IN_STRING_HOLE = /\{\{holes\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\}\}/g;

function holeValue(values, name, attr) {
  const v = values[name];
  return attr !== undefined ? v[attr] : (v.ref ?? v.value);
}

function resolveHoles(node, values) {
  if (typeof node === 'string') {
    const whole = node.match(WHOLE_HOLE);
    if (whole) return holeValue(values, whole[1], whole[2]);
    return node.replace(IN_STRING_HOLE, (_, name, attr) => String(holeValue(values, name, attr)));
  }
  if (Array.isArray(node)) return node.map((n) => resolveHoles(n, values));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolveHoles(v, values)]));
  }
  return node;
}

/** Instantiate one concrete case from a template. Pure in (template, bedUsers, seed, index). */
export function mintCase(template, { bedUsers, seed, index }) {
  const values = drawHoles(template, { bedUsers, seed, index });
  const { holes, ...rest } = template;
  const caseObj = resolveHoles(structuredClone(rest), values);
  caseObj.id = `CASE-${template.id.slice('TPL-'.length)}-g${index}`;
  caseObj.from = { ...template.from, template: template.id, seed, instance: index };
  return caseObj;
}

/** Mint the full per-run set for a template registry, in stable order. */
export function mintAll(templates, { bedUsers, seed, perTemplate = INVARIANT_CASES_PER_RUN }) {
  const minted = [];
  for (const template of [...templates.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (let index = 0; index < perTemplate; index++) {
      minted.push({ template: template.id, instance: index, caseObj: mintCase(template, { bedUsers, seed, index }) });
    }
  }
  return minted;
}
