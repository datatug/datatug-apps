import { IBuildInfo } from '@sneat/core-public';

// This app's committed placeholder for its own build metadata — provided at
// bootstrap via `provideBuildInfo(buildInfo)` (see main.ts), which the
// shared `<sneat-app-version />` (@sneat/components' AppVersionComponent)
// renders in the side menu instead of that component's own (never-restamped)
// placeholders baked into the published npm package. See
// sneat-co/sneat-libs' libs/build-info/README.md "Consumer recipe" for the
// full contract this file, main.ts's provideBuildInfo() call, and the
// `stamp-build-info`/`check-build-info` Nx targets below all implement.
//
// Stamped ahead of every build/serve by `sneat-stamp-build-info`
// (`@sneat/build-info`, wired as the `stamp-build-info` Nx target in
// apps/datatug-app/project.json) — but never *this* file: the stamp runs
// against a gitignored copy, `build-info.generated.ts`, which an Angular
// `fileReplacements` config (project.json's build/serve configurations)
// swaps in for `./build-info` at build time. This file is never touched by
// a build, so `git status` stays clean after `nx build`/`nx serve` — the
// placeholders below must always stay committed exactly as-is.
//
// `check-build-info` (`sneat-stamp-build-info --check`) and
// build-info.spec.ts's "keeps placeholders committed" test (reading the
// *committed* blob via `git show HEAD:...`) both guard that.
export const buildInfo: IBuildInfo = {
  version: 'version t0be$et',
  gitHash: 'gitHash t0be$et',
  buildTimestamp: 'timestamp t0be$et',
};
