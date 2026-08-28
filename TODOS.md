# TODOS

## P3 — Lint-warn on empty `expect` bodies
- **What:** Validator emits a warning when a case's `expect` has `body: {}` (or omits body matchers entirely): "expect asserts nothing beyond status."
- **Why:** Subset matching means an empty expected body passes against any response — a case that asserts nothing while looking like a test. Silent no-op tests are the classic declarative-suite rot.
- **Pros:** Catches the footgun at author time; warn-not-refuse keeps legitimate status-only cases legal.
- **Cons:** One more validator rule to maintain; a rare intentional status-only case sees a warning it must ignore.
- **Context:** CEO review Section 4 finding (2026-08-27). Depends on the PR1 validator existing. See RFC 0001 §4.3 for subset-match semantics (Jest `toMatchObject`).
- **Effort:** S (human) → S (CC, ~10 min). **Priority:** P3. **Blocked by:** PR1 validator.

## Carried into /plan-eng-review — static `$ref` resolution scope
- **What:** Decide whether static resolution of `$alias`/`$users` tokens (typo fails at validate time, not runtime) is PR1 validator core or a follow-up.
- **Why:** The 2022 ancestor crashed at runtime on exactly this error class. CEO review recommended building it into PR1; the decision was deferred to the engineering review (user, 2026-08-27).
- **Effort:** S (CC ~15 min). **Priority:** P2. **Blocked by:** eng review decision.
