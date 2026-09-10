import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonInput, IonItem, IonItemDivider, IonLabel, IonNote } from '@ionic/angular';
import { buildInfo } from './build-info';

// Side-menu build-info panel — shows the app version, short git hash, and
// UTC build timestamp at the bottom of the menu (datatug-menu.component.html).
// Local sibling of sneat-co/sneat-libs' AppVersionComponent
// (libs/components/src/lib/app-version/, selector `sneat-app-version`,
// published as part of @sneat/components), not a reuse of it: that
// component's `buildInfo` is a compile-time import baked into the published
// npm package at sneat-libs' own build, so it always shows sneat-libs' own
// (never-restamped) placeholder values, not this app's git hash — see
// build-info.ts's header comment. Same visual shape (an ion-item-divider
// "App version" section + a readonly build line), extended with a version
// row, driven by this repo's own stamped build-info.ts instead.
@Component({
  selector: 'sneat-datatug-menu-build-info',
  templateUrl: './menu-build-info.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItemDivider, IonLabel, IonItem, IonNote, IonInput],
})
export class MenuBuildInfoComponent {
  protected readonly buildInfo = buildInfo;
  protected readonly shortGitHash = buildInfo.gitHash.substring(0, 7);
}
