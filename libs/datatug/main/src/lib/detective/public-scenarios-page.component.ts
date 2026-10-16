import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { InvestigationScenario, ScenarioStep } from './models';
import { Observable } from 'rxjs';
import { projectPageHref } from '../nav/project-page-href';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  InvalidPublicScenarioError,
  PublicScenarioCatalogService,
  PublicScenarioNotFoundError,
  isCanonicalPublicDemo,
} from './public-scenario-catalog';

@Component({
  selector: 'sneat-datatug-public-scenarios-page',
  templateUrl: './public-scenarios-page.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class PublicScenariosPageComponent {
  @Input() showHeader = true;

  private readonly route = inject(ActivatedRoute);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly catalogService = inject(PublicScenarioCatalogService);
  private readonly project = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });
  protected readonly projectRef = computed(() => this.project()?.ref);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly scenarioId = computed(
    () => this.params().get('scenarioId') || undefined,
  );
  protected readonly isDemo = computed(() =>
    isCanonicalPublicDemo(this.projectRef()),
  );
  protected readonly listing = computed(() => !this.scenarioId());
  protected readonly scenarios = signal<InvestigationScenario[]>([]);
  protected readonly scenario = signal<InvestigationScenario | undefined>(
    undefined,
  );
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly missing = signal(false);
  private readonly retryVersion = signal(0);

  private readonly load = effect((onCleanup) => {
    const ref = this.projectRef();
    const isDemo = isCanonicalPublicDemo(ref);
    const id = this.scenarioId();
    this.retryVersion();
    this.scenarios.set([]);
    this.scenario.set(undefined);
    this.loading.set(false);
    this.error.set('');
    this.missing.set(false);
    if (!isDemo || !ref) return;
    this.loading.set(true);
    const request: Observable<InvestigationScenario | InvestigationScenario[]> =
      id ? this.catalogService.get(ref, id) : this.catalogService.list(ref);
    const subscription = request.subscribe({
      next: (value) => {
        if (id) this.scenario.set(value as InvestigationScenario);
        else this.scenarios.set(value as InvestigationScenario[]);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        if (failure instanceof PublicScenarioNotFoundError) {
          this.missing.set(true);
        } else {
          this.error.set(publicScenarioErrorMessage(failure));
        }
        this.loading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });

  protected retry(): void {
    this.retryVersion.update((version) => version + 1);
  }

  protected scenariosHref(): string {
    return projectPageHref(this.projectRef(), 'detective');
  }

  protected scenarioHref(id: string): string {
    return projectPageHref(this.projectRef(), ['detective', 'scenarios', id]);
  }

  protected stepHref(step: ScenarioStep): string {
    if (step.kind === 'check') {
      return projectPageHref(this.projectRef(), ['checks', step.ref]);
    }
    return `${projectPageHref(this.projectRef(), ['query', step.ref])}?id=${encodeURIComponent(step.ref)}`;
  }

  protected stepInstruction(step: ScenarioStep): string {
    return step.kind === 'query' ? 'Inspect the saved query' : 'Run the Check';
  }

  protected stepLabel(step: ScenarioStep): string {
    return step.kind === 'query' ? 'Saved query' : 'Check';
  }

  protected stepTarget(step: ScenarioStep): string {
    return step.kind === 'query' ? `Query: ${step.ref}` : `Check: ${step.ref}`;
  }
}

function publicScenarioErrorMessage(error: unknown): string {
  if (error instanceof InvalidPublicScenarioError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    error.message.includes('GitHub API rate limit')
  ) {
    return error.message;
  }
  return 'Could not load the public Scenario catalog. Please try again.';
}
