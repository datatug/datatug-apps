import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { projectPageHref } from '../nav/project-page-href';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from './detective-client.service';
import { useDetectivePageContext } from './detective-page-context';
import { DetectiveState } from './models';

@Component({
  selector: 'sneat-datatug-scenario-detail-page',
  templateUrl: './scenario-detail-page.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    IonBackButton,
    IonBadge,
    IonButtons,
    IonCard,
    IonCardContent,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class ScenarioDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(DetectiveClientService);
  protected readonly scope = useDetectivePageContext();
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly scenarioId = computed(() =>
    this.params().get('scenarioId'),
  );
  protected readonly casesUrl = computed(() =>
    projectPageHref(this.scope.ref(), 'detective'),
  );
  protected readonly state = signal<DetectiveState | undefined>(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly scenario = computed(() =>
    this.state()?.scenarios.find((item) => item.id === this.scenarioId()),
  );

  private readonly loadState = effect((onCleanup) => {
    const context = this.scope.context();
    const scopeIdentity = this.scope.identity();
    const scenarioId = this.scenarioId();
    this.state.set(undefined);
    this.error.set('');
    if (!context || !scopeIdentity || !scenarioId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    const subscription = this.client.state(context).subscribe({
      next: (state) => {
        if (
          this.scope.identity() !== scopeIdentity ||
          this.scenarioId() !== scenarioId
        )
          return;
        this.state.set(state);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        if (
          this.scope.identity() !== scopeIdentity ||
          this.scenarioId() !== scenarioId
        )
          return;
        this.error.set(detectiveErrorMessage(error, context.kind === 'cloud'));
        this.loading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });
}
