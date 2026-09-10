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
// `version` is kept as a plain literal (not imported from package.json):
// a lib importing the workspace root package.json trips
// @nx/enforce-module-boundaries ("Imports of apps are forbidden" — Nx
// treats an import resolved outside any lib/app project as an app-only
// import). tools/stamp-build-info.mjs rewrites it on every stamp from
// the actual root package.json "version" field, the same way it rewrites
// gitHash/buildTimestamp below, so it can't drift from what's released —
// it just isn't placeholder-guarded the way those two are, since a real
// version number is safe to have committed (it only changes when someone
// bumps package.json, at which point the next stamp+commit here catches
// up).
//
// TODO: needs a pre-commit hook to check gitHash and buildTimestamp are NOT
// committed with real values (same gap sneat-libs' own TODO comment flags
// and has not yet closed). Until then, build-info.spec.ts's "keeps
// placeholders committed" test reads the *committed* blob via
// `git show HEAD:...` — a working tree that tools/stamp-build-info.mjs has
// already stamped (e.g. mid-`nx run-many`) does not fool that check, only
// an actual commit does.
export const buildInfo: {
  readonly version: string;
  readonly gitHash: string;
  readonly buildTimestamp: string;
} = {
  version: '0.0.0',
  gitHash: 'gitHash t0be$et',
  buildTimestamp: 'timestamp t0be$et',
};
