import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
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
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { tap } from 'rxjs/operators';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { projectPageHref } from '../nav/project-page-href';
import { isCanonicalPublicDemo } from './public-scenario-catalog';
import { DetectiveDemoStarterComponent } from './detective-demo-starter.component';

export type PublicDemoInvestigationSection = 'sessions' | 'incidents';

const SAMPLES = {
  sessions: {
    id: 'customer-coverage-investigation',
    title: 'Customer coverage investigation',
    description:
      'A sample Session that groups the Chinook customer inventory query with its coverage Checks.',
    story:
      'This pre-recorded example groups the saved inventory query and coverage Checks. The demo baseline comparison expects 60 customers and observes 59; it is not a fresh server result.',
  },
  incidents: {
    id: 'customer-coverage-gap',
    title: 'Customer coverage is one below expected',
    description:
      'A sample Incident example linked to an intentional customer coverage failure.',
    story:
      'This pre-recorded example compares the Chinook demo baseline with the expected count of 60 and observed count of 59. It is not a fresh server result, and opening a Check does not create an Incident.',
  },
} as const;

/** Curated public examples. These objects are display-only and never enter workspace services. */
@Component({
  selector: 'sneat-public-demo-investigation-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgTemplateOutlet,
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
    IonTitle,
    IonToolbar,
    DetectiveDemoStarterComponent,
  ],
  templateUrl: './public-demo-investigation-preview.component.html',
  styleUrl: './public-demo-investigation-preview.component.scss',
})
export class PublicDemoInvestigationPreviewComponent {
  readonly sectionInput = input<PublicDemoInvestigationSection | undefined>(
    undefined,
    { alias: 'section' },
  );
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navContext = inject(DatatugNavContextService);
  protected readonly projectReady = signal(false);
  private readonly project = toSignal(
    this.navContext.currentProject.pipe(
      tap((project) => {
        if (project?.ref) this.projectReady.set(true);
      }),
    ),
    { initialValue: undefined },
  );
  private readonly routeParams = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly section = computed<PublicDemoInvestigationSection>(
    () =>
      this.sectionInput() ??
      (this.route.snapshot.data['section'] === 'incidents'
        ? 'incidents'
        : 'sessions'),
  );
  protected readonly exampleId = computed(
    () => this.routeParams().get('exampleId') ?? undefined,
  );
  protected readonly projectRef = computed(() => this.project()?.ref);
  protected readonly isCanonicalDemo = computed(() =>
    isCanonicalPublicDemo(this.projectRef()),
  );
  protected readonly sample = computed(() => SAMPLES[this.section()]);
  protected readonly example = computed(() =>
    this.exampleId() === this.sample().id ? this.sample() : undefined,
  );
  protected readonly listing = computed(() => !this.exampleId());

  protected projectHref(page: string) {
    return this.router.parseUrl(projectPageHref(this.projectRef(), page));
  }

  protected listHref() {
    return this.projectHref(this.section());
  }

  protected exampleHref() {
    return this.projectHref(`${this.section()}/examples/${this.sample().id}`);
  }

  protected queryHref() {
    const queryId = 'demodb/chinook-customer-inventory';
    const tree = this.router.parseUrl(
      projectPageHref(this.projectRef(), ['query', queryId]),
    );
    tree.queryParams = { ...tree.queryParams, id: queryId };
    return tree;
  }

  protected checkHref(id: string) {
    return this.projectHref(`checks/${id}`);
  }
}
