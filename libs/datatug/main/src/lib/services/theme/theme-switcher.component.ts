import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  contrastOutline,
  moonOutline,
  sunnyOutline,
} from 'ionicons/icons';
import { isThemeMode, ThemeService } from './theme.service';

/** Compact Light / Dark / Auto control. */
@Component({
  selector: 'sneat-theme-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, IonSegmentButton, IonIcon, IonLabel],
  template: `
    <ion-segment
      class="theme-switcher"
      aria-label="Colour theme"
      data-testid="theme-switcher"
      [value]="theme.mode()"
      (ionChange)="onChange($event.detail.value)"
    >
      <ion-segment-button layout="icon-start" value="light" data-testid="theme-light">
        <ion-icon name="sunny-outline" aria-hidden="true" />
        <ion-label>Light</ion-label>
      </ion-segment-button>
      <ion-segment-button layout="icon-start" value="dark" data-testid="theme-dark">
        <ion-icon name="moon-outline" aria-hidden="true" />
        <ion-label>Dark</ion-label>
      </ion-segment-button>
      <ion-segment-button layout="icon-start" value="auto" data-testid="theme-auto">
        <ion-icon name="contrast-outline" aria-hidden="true" />
        <ion-label>Auto</ion-label>
      </ion-segment-button>
    </ion-segment>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      max-width: 20rem;
    }
    ion-segment-button {
      min-height: 44px;
      --padding-start: 4px;
      --padding-end: 4px;
      --indicator-color: var(--ion-color-primary);
      --color-checked: var(--ion-color-primary);
      --color: var(--ion-text-color);
    }
    ion-segment-button ion-icon {
      margin: 0 6px 0 0;
    }
  `,
})
export class ThemeSwitcherComponent {
  protected readonly theme = inject(ThemeService);

  constructor() {
    addIcons({ sunnyOutline, moonOutline, contrastOutline });
  }

  protected onChange(value: unknown): void {
    if (isThemeMode(value)) {
      this.theme.setMode(value);
    }
  }
}
