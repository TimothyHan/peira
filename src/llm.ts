// The one model-facing surface (RFC 0001 invariant 1: compile and triage only, never runtime).
// Per decision D3 (2026-08-29): the default transport is the author's own Claude session via
// the Claude Code CLI in headless mode — `claude -p`, prompt over stdin. No API key, no SDK,
// zero dependencies. Tests point PEIRA_CLAUDE_BIN at a canned-output script, so the spawn path
// is exercised for real without a network.

import { spawn } from 'node:child_process';
import { COMPILE_MODEL, COMPILE_TIMEOUT_MS } from './constants.js';
import { TransportError } from './errors.js';

export { TransportError };

export function claudeCliTransport({ bin = process.env.PEIRA_CLAUDE_BIN ?? 'claude', model = COMPILE_MODEL }: { bin?: string; model?: string } = {}): (prompt: string) => Promise<string> {
  return (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      // Windows installs CLIs as .cmd shims, which spawn() cannot execute directly (it fails
      // with EFTYPE/ENOENT); the shell resolves them. `bin` is our own constant or the
      // operator's PEIRA_CLAUDE_BIN, never model output, so this is not an injection surface.
      const child = spawn(bin, ['-p', '--model', model], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new TransportError(`claude CLI timed out after ${COMPILE_TIMEOUT_MS}ms`));
      }, COMPILE_TIMEOUT_MS);

      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new TransportError(`could not spawn "${bin}": ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new TransportError(`claude CLI exited ${code}: ${stderr.trim().slice(0, 400)}`));
        } else {
          resolve(stdout);
        }
      });
      child.stdin.end(prompt);
    });
}
