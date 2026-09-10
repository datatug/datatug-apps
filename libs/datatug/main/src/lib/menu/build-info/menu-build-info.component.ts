import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { IonIcon, IonItem, IonLabel, IonNote } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronDownOutline, chevronUpOutline } from 'ionicons/icons';
import { buildInfo } from './build-info';

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
// Local sibling of sneat-co/sneat-libs' AppVersionComponent
// (libs/components/src/lib/app-version/, selector `sneat-app-version`,
// published as part of @sneat/components), not a reuse of it: that
// component's `buildInfo` is a compile-time import baked into the published
// npm package at sneat-libs' own build, so it always shows sneat-libs' own
// (never-restamped) placeholder values, not this app's git hash — see
// build-info.ts's header comment. Driven by this repo's own stamped
// build-info.ts instead.
//
// No ion-input: a readonly ion-input previously broke Playwright locators
// (.inputValue() needs a native form control; ion-input is a Stencil
// shadow-DOM component) and the e2e spec had to read the "value" DOM
// property instead of using Playwright's normal text assertions. Plain
// ion-item/ion-label/ion-note here so build-info-version/build-info-hash
// are ordinary text nodes.
@Component({
  selector: 'sneat-datatug-menu-build-info',
  templateUrl: './menu-build-info.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItem, IonLabel, IonNote, IonIcon],
})
export class MenuBuildInfoComponent {
  protected readonly buildInfo = buildInfo;
  protected readonly shortGitHash = buildInfo.gitHash.substring(0, 7);

  protected readonly expanded = signal(false);

  // The copyright range must end with the build year, never a hand-committed
  // one (founder: "make the year range end in the build year automatically
  // so it is never stale"). buildInfo.buildTimestamp is an ISO-8601 UTC
  // instant once stamped (see tools/stamp-build-info.mjs), but stays the
  // committed placeholder "timestamp t0be$et" whenever this renders off an
  // unstamped working tree (e.g. `test` has no Nx dependsOn on `build`) —
  // `new Date(placeholder)` is Invalid Date, so fall back to the current
  // year rather than rendering "NaN".
  protected readonly copyrightEndYear = computed(() => {
    const stamped = new Date(buildInfo.buildTimestamp).getUTCFullYear();
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
