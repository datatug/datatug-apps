import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonButton, IonNote, IonSpinner } from '@ionic/angular';
import { SneatAuthStateService } from '@sneat/auth-core';
import { firstValueFrom, filter, take, timeout } from 'rxjs';
import { isSharedProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';

/** Public entry whose first persistent action creates a private, server-owned demo. */
@Component({
  selector: 'sneat-datatug-detective-demo-starter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonNote, IonSpinner],
  template: `
    <ion-button (click)="start()" [disabled]="busy()">
      @if (busy()) {
        <ion-spinner slot="start" name="dots" />
      }
      {{
        signedIn()
          ? 'Open private Detective demo'
          : 'Sign in to start Detective demo'
      }}
    </ion-button>
    @if (error()) {
      <ion-note color="danger" role="alert">{{ error() }}</ion-note>
    }
  `,
})
export class DetectiveDemoStarterComponent {
  readonly destination = input<'checks' | 'detective'>('detective');
  private readonly auth = inject(SneatAuthStateService);
  private readonly client = inject(DetectiveClientService);
  private readonly router = inject(Router);
  private readonly authState = toSignal(this.auth.authState, {
    initialValue: undefined,
  });
  protected readonly signedIn = () => !!this.authState()?.user?.uid;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private operationId?: string;

  protected async start(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.operationId ??= crypto.randomUUID();
    try {
      if (!this.signedIn()) {
        await this.auth.signInWith('google.com');
        await firstValueFrom(
          this.auth.authState.pipe(
            filter((state) => !!state.user?.uid),
            take(1),
            timeout(15000),
          ),
        );
      }
      const ref = await firstValueFrom(
        this.client.demoProject(undefined, this.operationId),
      );
      if (!isSharedProjectRef(ref))
        throw new Error(
          'The server returned an invalid demo project reference.',
        );
      this.operationId = undefined;
      await this.router.navigateByUrl(projectPageHref(ref, this.destination()));
    } catch (error) {
      this.error.set(detectiveErrorMessage(error, true));
    } finally {
      this.busy.set(false);
    }
  }
}
