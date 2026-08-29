// The pre-registered shift catalog (PR5 D1). Every entry is labeled with its ground truth
// BEFORE any triage runs — no post-hoc labeling. Truth is judged against the CURRENT (amended)
// intent in intent/. Shifts that fail no case are excluded by construction (subset matching
// tolerates them); genuinely contested shifts (e.g. submit 200→202, where the quality-attribute
// prose says "200 or 4xx") are kept OUT of the graded catalog and handled as adjudication
// specimens in the findings.
//
// Labeling asymmetry worth stating: dropping/renaming fields on the STATUS body is a bug
// because intent 3.3 names id/status/result; changing/dropping fields inside the error
// ENVELOPE is drift because the intent pins status codes, never envelope wording or shape.

export const PLANTS = {
  // --- bugs: behavior contradicts what the intent names ---
  'submit-500':             { truth: 'bug',   desc: 'POST /groovy/submit always 500', flags: { routeStatus: { '/groovy/submit': { 200: 500 } } } },
  'status-500':             { truth: 'bug',   desc: 'GET /groovy/status always 500', flags: { routeStatus: { '/groovy/status': { 200: 500 } } } },
  'submit-id-renamed':      { truth: 'bug',   desc: 'submit response id -> requestId (2.3 names the id)', flags: { rename: [{ route: '/groovy/submit', from: 'id', to: 'requestId' }] } },
  'status-id-renamed':      { truth: 'bug',   desc: 'status body id -> uuid (3.3 names id)', flags: { rename: [{ route: '/groovy/status', from: 'id', to: 'uuid' }] } },
  'status-result-dropped':  { truth: 'bug',   desc: 'status body loses result (3.3 names result)', flags: { drop: [{ route: '/groovy/status', field: 'result' }] } },
  'status-status-dropped':  { truth: 'bug',   desc: 'status body loses status (3.3 names status)', flags: { drop: [{ route: '/groovy/status', field: 'status' }] } },
  'stuck-pending':          { truth: 'bug',   desc: 'jobs never leave PENDING (4.7 promises COMPLETED)', flags: { stuckPending: true } },
  'result-always-null':     { truth: 'bug',   desc: 'COMPLETED jobs carry result null (results promised)', flags: { resultNull: true } },
  'auth-accept-any':        { truth: 'bug',   desc: 'wrong passwords accepted (1.3 demands 401)', flags: { authAcceptAny: true } },
  'anon-accepted':          { truth: 'bug',   desc: 'missing credentials accepted (1.5 demands 401)', flags: { anonAccept: true } },
  'accepts-empty-body':     { truth: 'bug',   desc: 'submit accepts {} (2.1 demands 400/422)', flags: { acceptInvalidSubmit: 'empty' } },
  'accepts-garbage-field':  { truth: 'bug',   desc: 'submit accepts extra fields (2.2 demands 400/422)', flags: { acceptInvalidSubmit: 'garbage' } },
  'accepts-numeric-code':   { truth: 'bug',   desc: 'submit accepts code: 123 (2.4 demands 400/422)', flags: { acceptInvalidSubmit: 'numeric' } },
  'accepts-syntax-error':   { truth: 'bug',   desc: 'syntax errors accepted (4.3 demands 400 + message)', flags: { acceptInvalidSubmit: 'syntax' } },
  'unknown-id-200':         { truth: 'bug',   desc: 'unknown id answers 200 (3.5 demands 404)', flags: { unknownId200: true } },
  'invalid-id-500':         { truth: 'bug',   desc: 'malformed id answers 500 (3.6, amended, demands 400)', flags: { invalidId500: true } },
  'cross-user-200':         { truth: 'bug',   desc: "other users' jobs fully visible (isolation)", flags: { crossUser200: true } },
  'failed-marked-completed':{ truth: 'bug',   desc: 'failing scripts reported COMPLETED (4.4/4.8)', flags: { failedCompleted: true } },
  'queue-capacity-one':     { truth: 'bug',   desc: 'only one parallel execution (5.3 promises two)', flags: { capacity: 1 } },
  'queue-capacity-three':   { truth: 'bug',   desc: 'three parallel executions (5.3 caps at two)', flags: { capacity: 3 } },
  'status-label-lowercase': { truth: 'bug',   desc: 'lifecycle labels lowercased (4.5-4.8 name PENDING/…/FAILED)', flags: { statusLabelMap: { PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', FAILED: 'failed' } } },

  // --- drifts: only the encoded expectation breaks; the intent is silent ---
  'validation-message-text':{ truth: 'drift', desc: "validation envelopes say 'Validation failed: request rejected' instead of '' (message text unpinned)", flags: { envelopeMessage: 'Validation failed: request rejected' } },
  'timestamp-numeric':      { truth: 'drift', desc: 'envelope timestamp becomes a number (format unpinned)', flags: { timestampNumeric: true } },
  'error-label-recased':    { truth: 'drift', desc: "envelope error 'Bad Request' -> 'BAD REQUEST' (casing unpinned)", flags: { labelMap: { 'Bad Request': 'BAD REQUEST' } } },
  'notfound-label-changed': { truth: 'drift', desc: "envelope error 'Not Found' -> 'No such resource' (wording unpinned)", flags: { labelMap: { 'Not Found': 'No such resource' } } },
  'unauthorized-label-changed': { truth: 'drift', desc: "envelope error 'Unauthorized' -> 'Access denied' (the intent pins the 401, not the body wording)", flags: { labelMap: { Unauthorized: 'Access denied' } } },
  'path-with-query':        { truth: 'drift', desc: 'envelope path includes the query string (path field unpinned)', flags: { pathWithQuery: true } },
  'envelope-status-string': { truth: 'drift', desc: "envelope status field becomes a string ('400') (envelope shape unpinned)", flags: { envelopeStatusString: true } },
  'envelope-drops-path':    { truth: 'drift', desc: 'envelope loses its path field (envelope shape unpinned)', flags: { dropEnvelopeField: 'path' } },
  'envelope-drops-message': { truth: 'drift', desc: 'envelope loses its message field (envelope shape unpinned)', flags: { dropEnvelopeField: 'message' } },

  // --- flakes: nondeterministic faults ---
  'fail-every-3rd-status':  { truth: 'flake', desc: 'every 3rd status request answers 500', flags: { failEveryN: { n: 3, route: '/groovy/status' } } },
  'fail-first-2':           { truth: 'flake', desc: 'the first 2 requests after boot answer 500', flags: { failFirstN: 2 } },
  'submit-fail-random':     { truth: 'flake', desc: '~20% of submits answer 500 (genuinely random)', flags: { failProb: { p: 0.2, route: '/groovy/submit' } } },
};
