/**
 * Phase 0 feature flag (single, shared by all six pages — see
 * `spec/research/2026-09-09-web-ui-audit.md` "UI without real backing"):
 * Widgets, Tags, Resources, Variables, DB models (list + detail), and Diff
 * are routed pages that render a header over an empty `<ion-content>` —
 * nothing signals to a user that they are unfinished before clicking in.
 *
 * Defaults to `false` (hidden): their routes are left out of the `Routes`
 * arrays entirely and their menu entries are omitted, so there is nothing to
 * click into. Flip to `true` locally to work on one of them.
 */
export const ENABLE_EMPTY_SHELL_PAGES = false;
