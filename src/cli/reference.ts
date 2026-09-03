// `peira reference` — print the installed version's complete vocabulary. For agents and for
// anyone who would otherwise read dist/ to find out what the tool can say.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReference } from '../reference.js';
import type { CliContext } from './context.js';

export async function main(_ctx: CliContext): Promise<number> {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
  // main.ts calls process.exit right after this returns; a large write to a PIPE is async and
  // would be cut off mid-document. Wait for the flush before handing back the exit code.
  await new Promise<void>((resolve, reject) => process.stdout.write(renderReference({ version }), (err) => (err ? reject(err) : resolve())));
  return 0;
}
