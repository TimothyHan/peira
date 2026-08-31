// ANSI color for terminal output ONLY — never in evidence logs, reports, or files.
// Auto-disabled when output is piped (either stream), under NO_COLOR, or on a dumb
// terminal, so machine consumers always see plain text.

const enabled =
  process.stdout.isTTY === true &&
  process.stderr.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb';

const wrap = (code: string) => (text: string): string => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);

export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');
export const cyan = wrap('36');
export const dim = wrap('2');

/** The verdict trio, colored the way every reader already expects. */
export function verdictColor(verdict: 'pass' | 'fail' | 'error'): (text: string) => string {
  return verdict === 'pass' ? green : verdict === 'fail' ? red : yellow;
}

/** Triage classifications: bug amber (a finding), drift cyan (a decision), flake dim (inconclusive). */
export function triageColor(classification: string): (text: string) => string {
  return classification === 'bug' ? yellow : classification === 'drift' ? cyan : dim;
}
