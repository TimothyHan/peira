// Case loading: recursive *.json under a root, sorted by path — sorted order IS execution order.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function listCaseFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'steps') walk(full); // a steps/ subdirectory holds step definitions, not cases
      }
      else if (entry.endsWith('.json') && entry !== 'compile-manifest.json') out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Returns { loaded: [{file, caseObj}], parseErrors: string[] }. */
export function loadCases(root) {
  const loaded = [];
  const parseErrors = [];
  for (const file of listCaseFiles(root)) {
    const rel = relative(process.cwd(), file);
    try {
      loaded.push({ file: rel, caseObj: JSON.parse(readFileSync(file, 'utf8')) });
    } catch (err) {
      parseErrors.push(`${rel}: not valid JSON — ${err.message}`);
    }
  }
  return { loaded, parseErrors };
}
