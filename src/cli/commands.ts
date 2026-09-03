// The command roster, in one place. main.ts dispatches from it, `peira reference` lists it,
// and the drift test asserts every name appears in USAGE and in docs/REFERENCE.md.
export const COMMAND_NAMES = ['init', 'validate', 'run', 'compile', 'stats', 'triage', 'evidence', 'trust', 'render', 'adopt', 'stamp', 'reference'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];
