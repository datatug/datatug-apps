import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
} from '@ionic/angular';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { CheckDefinition, CheckRun } from './models';
import {
  PublicDemoChecksService,
  publicCheckUnsupported,
} from './public-demo-checks.service';
import { ValidationRunResultsComponent } from './validation-run-results.component';

@Component({
  selector: 'sneat-public-demo-checks',
  templateUrl: './public-demo-checks.component.html',
  styleUrl: './detective-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonCard,
    IonCardContent,
    IonItem,
    IonLabel,
    IonList,
    IonSpinner,
    ValidationRunResultsComponent,
  ],
})
export class PublicDemoChecksComponent {
  readonly project = input.required<IProjectRef>();
  readonly checkId = input<string>();
  private readonly service = inject(PublicDemoChecksService);
  protected readonly checks = signal<CheckDefinition[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly runs = signal<CheckRun[]>([]);
  protected readonly selectedRun = signal<CheckRun | undefined>(undefined);
  protected readonly current = computed(() =>
    this.checks().find((check) => check.id === this.checkId()),
  );
  protected readonly unsupported = computed(() =>
    this.current()
      ? publicCheckUnsupported(this.current() as CheckDefinition)
      : '',
  );
  protected readonly history = computed(() =>
    this.runs().filter((run) => run.checkId === this.checkId()),
  );
  protected readonly displayedRun = computed(
    () => this.selectedRun() || this.history()[0],
  );
  private generation = 0;
  private readonly load = effect((onCleanup) => {
    const project = this.project();
    let active = true;
    this.checks.set([]);
    this.runs.set([]);
    void this.loadChecks(project, () => active);
    onCleanup(() => {
      active = false;
      this.generation++;
    });
  });
  private readonly selection = effect(() => {
    this.checkId();
    this.generation++;
    this.busy.set(false);
    this.error.set('');
    this.selectedRun.set(undefined);
  });
  protected url(id?: string): string {
    return projectPageHref(this.project(), id ? ['checks', id] : 'checks');
  }
  protected queryUrl(id: string): string {
    const url = projectPageHref(this.project(), ['query', id]);
    return `${url}${url.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
  }
  protected expected(check: CheckDefinition): string {
    return check.steps
      .flatMap((step) => step.validators || [])
      .map(
        (v) =>
          `${v.id}: ${v.kind} ${v.expected?.type === 'integer' ? v.expected.value : ''}`,
      )
      .join(' · ');
  }
  private async loadChecks(
    project: IProjectRef,
    active: () => boolean,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const checks = await this.service.load(project);
      if (active()) this.checks.set(checks);
    } catch (error) {
      if (active())
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Could not load public Checks.',
        );
    } finally {
      if (active()) this.loading.set(false);
    }
  }
  protected retry(): void {
    const generation = this.generation;
    void this.loadChecks(this.project(), () => generation === this.generation);
  }
  protected async run(): Promise<void> {
    const check = this.current();
    if (!check || this.busy() || this.unsupported()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const run = await this.service.run(this.project(), check);
      if (generation !== this.generation) return;
      this.runs.update((runs) => [run, ...runs].slice(0, 12));
      this.selectedRun.set(run);
    } catch (error) {
      if (generation === this.generation)
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Could not run this public Check.',
        );
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
