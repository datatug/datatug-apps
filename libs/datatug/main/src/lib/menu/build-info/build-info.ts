// Reuses the shape of sneat-co/sneat-libs'
// libs/components/src/lib/app-version/build-info.ts (the AppVersionComponent
// this mirrors), extended with `version`. Not the same file: that component
// is published inside the @sneat/components npm package with these two
// placeholders baked in at publish time — no consuming app's build ever
// re-stamps a node_modules copy, so `<sneat-app-version />` shows these
// literal placeholder strings wherever it's used today (including
// sneat.app itself; verified 2026-09-10, see PR description). DataTug needs
// its *own* commit hash, so this lives locally and is stamped by this
// repo's own build — see tools/stamp-build-info.mjs.
//
// version is NOT part of that placeholder contract: it's read directly from
// the workspace root package.json (real value, safe to commit) via the
// `@datatug/package-json` tsconfig path, so it never goes stale relative to
// what's actually released.
//
// TODO: needs a pre-commit hook to check gitHash and buildTimestamp are NOT
// committed with real values (same gap sneat-libs' own TODO comment flags
// and has not yet closed). Until then, build-info.spec.ts's "keeps
// placeholders committed" test reads the *committed* blob via
// `git show HEAD:...` — a working tree that tools/stamp-build-info.mjs has
// already stamped (e.g. mid-`nx run-many`) does not fool that check, only
// an actual commit does.
import { version } from '@datatug/package-json';

export const buildInfo: {
  readonly version: string;
  readonly gitHash: string;
  readonly buildTimestamp: string;
} = {
  version,
  gitHash: 'gitHash t0be$et',
  buildTimestamp: 'timestamp t0be$et',
};
