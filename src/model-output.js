// Shared plumbing for the two model-facing surfaces (compile, triage): a model reply is
// untrusted text until a JSON object is extracted from it. Fences stripped, first '{' to
// last '}', parsed or null — never throws, never partially accepts.

/** @returns {object | null} the parsed object, or null when no valid JSON object is present */
export function extractJsonObject(text) {
  const stripped = text.replace(/```[a-z]*\n?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
