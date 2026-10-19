/**
 * The password sign-in button of the shared @sneat/auth-ui email form. Below
 * 575px (phones) the form hides the " with password" suffix to keep the action
 * row on one line, so the accessible name is "Sign in" on mobile and
 * "Sign in with password" on desktop. "Sign up", "Get sign-in link" and the
 * "Sign in" segment tab (not a button) never match.
 */
export const SIGN_IN_BUTTON = /^Sign in(?:\s+with password)?$/;

/** Same button matched by text content, which still includes the hidden suffix. */
export const SIGN_IN_BUTTON_TEXT = /^\s*Sign in(?:\s+with password)?\s*$/;
