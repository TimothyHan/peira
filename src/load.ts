// Case loading: recursive *.json under a root, sorted by path — sorted order IS execution order.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Case, LoadedCase } from './types.js';

export function listCaseFiles(root: string): string[] {
  // a fresh project has no cases yet — an empty set, not a crash
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // steps/ and templates/ subdirectories hold their own artifact kinds, not cases
        if (entry !== 'steps' && entry !== 'templates') walk(full);
      }
      else if (entry.endsWith('.json') && entry !== 'compile-manifest.json' && entry !== 'bed.json') out.push(full);
    }
  };
  walk(root);
  return out;
}

export function loadCases(root: string): { loaded: LoadedCase[]; parseErrors: string[] } {
  const loaded: LoadedCase[] = [];
  const parseErrors: string[] = [];
  for (const file of listCaseFiles(root)) {
    const rel = relative(process.cwd(), file);
    try {
      loaded.push({ file: rel, caseObj: JSON.parse(readFileSync(file, 'utf8')) as Case });
    } catch (err) {
      parseErrors.push(`${rel}: not valid JSON — ${(err as Error).message}`);
    }
  }
  return { loaded, parseErrors };
}
