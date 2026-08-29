// The intent layer (RFC 0001 §4.2). Markdown in, addressable sections out.
// Segmentation is flat: every heading (## and deeper) opens a section whose body runs to the
// next heading of ANY level — sections never overlap, and a pure container heading (no body
// text of its own) yields no section. Tagged sections read `<!-- peira: id=… kind=… -->`;
// untagged sections DERIVE an id from the heading slug (kind=ac), so an existing test plan
// ingests with zero edits.
//
// The hash contract (lineage depends on it): sha256 over the section body normalized to LF
// line endings with per-line trailing whitespace stripped and leading/trailing blank lines
// trimmed; first 12 hex chars.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { INTENT_SECTION_MAX_LINES } from './constants.js';

const HEADING = /^(#{2,6})\s+(.+?)\s*$/;
const TAG = /<!--\s*peira:\s*([^>]*?)\s*-->/;

export function normalizeText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

export function hashSection(text) {
  return createHash('sha256').update(normalizeText(text)).digest('hex').slice(0, 12);
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** Parse one markdown document into sections. `usedIds` carries collision state across files. */
export function parseIntent(markdown, { file = null, usedIds = new Set() } = {}) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = current.bodyLines.join('\n');
    if (normalizeText(body) === '') return; // container heading — nothing to compile
    const tag = body.match(TAG);
    let id = null;
    let kind = 'ac';
    if (tag) {
      for (const pair of tag[1].split(/\s+/)) {
        const [k, v] = pair.split('=');
        if (k === 'id' && v) id = v;
        if (k === 'kind' && v) kind = v;
      }
    }
    if (kind !== 'ac' && kind !== 'invariant') {
      throw new Error(`${file ?? 'intent'}: section "${current.title}" has unknown kind "${kind}"`);
    }
    if (id === null) {
      // derive mode: slug of the heading, uniquified deterministically on collision
      const base = slugify(current.title);
      id = base;
      for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    } else if (usedIds.has(id)) {
      throw new Error(`${file ?? 'intent'}: duplicate intent id "${id}"`);
    }
    usedIds.add(id);
    sections.push({ id, kind, tagged: tag !== null, title: current.title, file, text: body, hash: hashSection(body) });
  };

  for (const line of lines) {
    const heading = line.match(HEADING) ?? line.match(/^(#)\s+(.+?)\s*$/);
    if (heading) {
      flush();
      // a level-1 title never opens a section, but it still closes the previous one
      current = heading[1].length >= 2 ? { title: heading[2], bodyLines: [] } : null;
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Intent lint: structural advice, never refusals. Sections are the unit of lineage, stale
 * detection, and targeted recompile — these warnings flag structures that make those coarse
 * or fragile.
 * @param {ReturnType<typeof parseIntent>} sections
 * @returns {string[]} warnings
 */
export function lintIntent(sections, { maxLines = INTENT_SECTION_MAX_LINES } = {}) {
  const warnings = [];
  for (const s of sections) {
    const lines = s.text.split('\n').filter((l) => l.trim() !== '').length;
    if (lines > maxLines) {
      warnings.push(`section "${s.id}" has ${lines} content lines — one promise per section keeps stale detection and triage precise; consider splitting`);
    }
  }
  const derived = sections.filter((s) => !s.tagged);
  for (const s of derived) {
    const collision = s.id.match(/^(.+)-\d+$/);
    if (collision && sections.some((other) => other.id === collision[1])) {
      warnings.push(`derived slug collision: "${s.id}" exists because two headings share the slug "${collision[1]}" — explicit <!-- peira: id=… --> tags make lineage stable`);
    }
  }
  return warnings;
}

/** Load every *.md under `dir` (sorted), one shared id namespace. */
export function loadIntentDir(dir) {
  const usedIds = new Set();
  const sections = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const markdown = readFileSync(join(dir, entry), 'utf8');
    sections.push(...parseIntent(markdown, { file: entry, usedIds }));
  }
  return sections;
}
