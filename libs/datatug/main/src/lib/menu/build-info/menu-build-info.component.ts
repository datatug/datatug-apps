import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { IonIcon, IonItem, IonLabel, IonNote } from '@ionic/angular';
import { BUILD_INFO, IBuildInfo } from '@sneat/core-public';
import { addIcons } from 'ionicons';
import { chevronDownOutline, chevronUpOutline } from 'ionicons/icons';

addIcons({ chevronDownOutline, chevronUpOutline });
// The template binds the icon `name` in kebab-case ('chevron-down-outline'
// / 'chevron-up-outline'), not the camelCase import names above: ionicons
// 8.0.13's runtime `getName()` lowercases whatever `name` it's given
// without inserting dashes (so a camelCase name arrives as e.g.
// "chevrondownoutline"), while `addIcons()` only ever registers the
// original camelCase key verbatim plus its kebab-case form — never an
// all-lowercase, no-dashes form. A camelCase `[name]` binding therefore
// never resolves (silent "[Ionicons Warning]: Could not load icon...",
// caught by apps/datatug-app/e2e/root-and-login.spec.ts's console-error
// assertion when this was first tried here). Verified empirically against
// node_modules/ionicons/dist/collection/components/icon/utils.js.

// Side-menu build-info footer — a single collapsed-by-default row showing
// the Sneat.Work copyright line, expandable to reveal the app version, short
// git hash, and UTC build timestamp (datatug-menu.component.html). Founder
// request 2026-09-11: the previous always-expanded "App version" card (an
// ion-item-divider + two rows, one of them a readonly ion-input) took too
// much side-menu space — collapse it behind one tappable row, mirroring the
// requested "## copyright line 🔽 / 🔼 --- Version / Build" shape.
//
// The copyright holder is Sneat.Work (https://sneat.work), the umbrella
// product/company DataTug.app ships under — not "DataTug.app" itself.
// Founder correction 2026-09-11: a previous pass wrongly kept DataTug.app
// as the copyright holder here.
//
// NOT swapped for sneat-co/sneat-libs' own `<sneat-app-version />`
// (@sneat/components' AppVersionComponent, selector `sneat-app-version`)
// despite the founder's "make it generic/reusable across all our apps"
// ruling: verified against the actual npm registry (not just sneat-libs'
// repo checkout, whose package.json already reads 0.27.23) that the
// published `@sneat/components` — only up to 0.27.22 as of this change —
// still ships that component's OLD shape: an always-expanded
// "App version" ion-item-divider card with no collapse/expand, no
// copyright line, and none of this component's data-testid hooks
// (`build-info-toggle`/`build-info-chevron`). Swapping to it today would
// both regress the founder-approved collapsed-by-default UI above and
// break apps/datatug-app/e2e/build-info.spec.ts. What this component DOES
// adopt now is the shared *runtime contract* those npm packages already
// publish correctly: `IBuildInfo`/`BUILD_INFO` (`@sneat/core-public`,
// identical between the published 0.27.22/0.27.23), injected here instead
// of a direct import — see apps/datatug-app/src/build-info.ts (this repo's
// own stamped placeholder) and main.ts's `provideBuildInfo(buildInfo)`. So
// the only remaining step to actually swap in `<sneat-app-version />`, once
// sneat-libs publishes a @sneat/components release containing the
// redesign, is deleting this file and its use in datatug-menu.component —
// no provider wiring changes needed anywhere.
//
// No ion-input: a readonly ion-input previously broke Playwright locators
// (.inputValue() needs a native form control; ion-input is a Stencil
// shadow-DOM component) and the e2e spec had to read the "value" DOM
// property instead of using Playwright's normal text assertions. Plain
// ion-item/ion-label/ion-note here so build-info-version/build-info-hash
// are ordinary text nodes.

// Fallback shown when BUILD_INFO hasn't been provided (e.g. a unit test
// that mounts this component directly, without app.ts's bootstrap
// providers) — mirrors the placeholders committed to
// apps/datatug-app/src/build-info.ts. Can't import that file directly: it
// now lives in the app project (apps/datatug-app/src/), and this component
// lives in a lib (libs/datatug/main) — @nx/enforce-module-boundaries
// forbids a lib importing from an app.
const FALLBACK_BUILD_INFO: IBuildInfo = {
  version: 'version t0be$et',
  gitHash: 'gitHash t0be$et',
  buildTimestamp: 'timestamp t0be$et',
};

@Component({
  selector: 'sneat-datatug-menu-build-info',
  templateUrl: './menu-build-info.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItem, IonLabel, IonNote, IonIcon],
})
export class MenuBuildInfoComponent {
  protected readonly buildInfo: IBuildInfo =
    inject(BUILD_INFO, { optional: true }) ?? FALLBACK_BUILD_INFO;
  protected readonly shortGitHash = this.buildInfo.gitHash.substring(0, 7);

  protected readonly expanded = signal(false);

  // The copyright range must end with the build year, never a hand-committed
  // one (founder: "make the year range end in the build year automatically
  // so it is never stale"). buildInfo.buildTimestamp is an ISO-8601 UTC
  // instant once stamped (see @sneat/build-info's README and this app's
  // `stamp-build-info` Nx target), but stays the committed placeholder
  // "timestamp t0be$et" whenever this renders off an unstamped build (e.g.
  // `test` has no Nx dependsOn on `build`) — `new Date(placeholder)` is
  // Invalid Date, so fall back to the current year rather than rendering
  // "NaN".
  protected readonly copyrightEndYear = computed(() => {
    const stamped = new Date(this.buildInfo.buildTimestamp).getUTCFullYear();
    return Number.isFinite(stamped) ? stamped : new Date().getUTCFullYear();
  });

  protected toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }

  // The copyright link must open sneat.work without toggling the row (the
  // ion-item's own (click) handler would otherwise also fire on bubble).
  protected onLinkClick(event: Event): void {
    event.stopPropagation();
  }
}
