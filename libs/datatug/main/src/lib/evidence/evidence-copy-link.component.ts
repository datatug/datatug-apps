import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { linkOutline } from 'ionicons/icons';
import type { IProjectRef } from '../core/project-context';
import { evidenceLinkUrl, type EvidenceLinkTarget } from './evidence-link';

/**
 * Copy link for one retained run (evidence-records REQ:copyable-evidence-link). The link names the run only; whoever
 * opens it still needs their own current access. Renders nothing for evidence that cannot be linked.
 */
@Component({
  selector: 'sneat-datatug-evidence-copy-link',
  imports: [IonButton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (url(); as link) {
    <span class="copy-link">
      <ion-button
        size="small"
        fill="clear"
        [title]="label() + ' (opens only for people who can already see it)'"
        (click)="copy(link)"
        ><ion-icon slot="start" name="link-outline" aria-hidden="true" />{{
          label()
        }}</ion-button
      >
      <span role="status" class="status">{{ status() }}</span>
      @if (manual()) {
        <input
          class="manual"
          type="text"
          readonly
          aria-label="Evidence link"
          [value]="link"
          (focus)="select($event)"
        />
      }
    </span>
  }`,
  styles: `
    :host {
      display: inline-block;
      max-width: 100%;
    }
    .copy-link {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 0.5rem;
      max-width: 100%;
    }
    .status {
      font-size: 0.8rem;
      color: var(--ion-color-step-650, var(--ion-text-color));
    }
    .manual {
      width: 100%;
      font: inherit;
      font-size: 0.8rem;
    }
  `,
})
export class EvidenceCopyLinkComponent {
  readonly projectRef = input<IProjectRef>();
  readonly environment = input('');
  readonly target = input<EvidenceLinkTarget>();
  readonly label = input('Copy link');
  protected readonly status = signal('');
  protected readonly manual = signal(false);
  protected readonly url = computed(() => {
    const target = this.target();
    return target
      ? evidenceLinkUrl(globalThis.location.origin, this.projectRef(), {
          environment: this.environment(),
          target,
        })
      : undefined;
  });

  constructor() {
    addIcons({ linkOutline });
    effect(() => {
      this.url();
      this.status.set('');
      this.manual.set(false);
    });
  }

  protected async copy(link: string) {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(link);
      if (this.url() !== link) return;
      this.manual.set(false);
      this.status.set(
        'Link copied. It opens only for people who can already see this run.',
      );
    } catch {
      if (this.url() !== link) return;
      this.manual.set(true);
      this.status.set('Copying is unavailable here; select the link below.');
    }
  }

  protected select(event: Event) {
    (event.target as HTMLInputElement).select();
  }
}
