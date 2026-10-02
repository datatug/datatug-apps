import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { demoBundle, demoSourceRuntime, type DemoSourceRuntime } from './demo-project';
import { DEMO_DATA_SOURCE_OVERRIDE_KEY, parseDemoConfig, resolveDemoDataSource, type DemoConfig } from './demo-config';
import { DemoInvestigationService } from './demo-investigation.service';
import {
  DEMO_HANDOFF_STORAGE_KEY, matchScenarioByQuestion, parseHandoff, scenarioById, type DemoHandoff, type DemoLang, type DemoScenario,
} from './demo-scenarios';
import { type Observation } from './investigation/observations';
import { renderMessage } from './trace/demo-messages';
import { DemoChooserComponent } from './ui/demo-chooser.component';
import { DemoObservationsComponent } from './ui/demo-observations.component';
import { DemoResultComponent } from './ui/demo-result.component';
import { DemoTraceComponent } from './ui/demo-trace.component';

const LANG_KEY = 'datatug.demo.lang.v1';
type View = 'booting' | 'chooser' | 'investigation';

function storage<T>(read: (s: Storage) => T, fallback: T): T {
  try { return read(sessionStorage); } catch { return fallback; }
}

/**
 * `/demo`: a visitor arrives from datatug.ai or datatug.io with a question and sees DataTug answer it,
 * with no sign-in, no AI and nothing sent to a server of ours. The investigation trace builds step by
 * step as the saved plan really runs in this browser tab; the answer is a grid and a chart; a follow-up
 * computes observations from the rows.
 */
@Component({
  selector: 'sneat-datatug-demo-page',
  templateUrl: './demo-page.component.html',
  styleUrls: ['./demo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoInvestigationService],
  imports: [
    IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonSpinner,
    DemoChooserComponent, DemoTraceComponent, DemoResultComponent, DemoObservationsComponent,
  ],
})
export class DemoPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly demo = inject(DemoInvestigationService);

  private readonly config: DemoConfig = parseDemoConfig(this.route.snapshot.data['demo']) ?? {
    enabled: true, dataSource: { kind: 'static' }, allowDataSourceOverride: false,
  };

  readonly lang = signal<DemoLang>('en');
  readonly view = signal<View>('booting');
  readonly notice = signal('');
  readonly slow = signal(false);
  readonly pinned = signal<ReadonlySet<string>>(new Set());
  readonly activeObservation = signal<string | undefined>(undefined);
  readonly bundle = demoBundle;
  readonly canRetry = computed(() => ['source-unavailable', 'failed', 'interrupted'].includes(this.demo.phase()));
  readonly observations = computed<readonly Observation[]>(() => this.demo.insight() ? this.demo.observations(this.lang()) : []);
  readonly chosenQuestion = signal('');
  readonly runtimeLabel = computed(() => this.runtimeInfo().label);
  private readonly runtimeInfo = signal<DemoSourceRuntime>(demoSourceRuntime(this.config.dataSource, location.origin));
  private recognised = true;

  private readonly resultColumn = viewChild<ElementRef<HTMLElement>>('resultColumn');
  private liveRun = false;

  constructor() {
    // When a live run's answer first appears below the fold (a phone), bring it into view.
    effect(() => {
      const column = this.resultColumn()?.nativeElement;
      if (!column || !this.liveRun) return;
      this.liveRun = false;
      if (column.getBoundingClientRect().top > window.innerHeight * 0.5) {
        column.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    });
    void this.boot();
  }

  t(key: string, params: Readonly<Record<string, string | number>> = {}): string { return renderMessage(this.lang(), key, params); }

  async chooseScenario(scenario: DemoScenario): Promise<void> {
    await this.run(scenario, this.chosenQuestion() || scenario.question[this.lang()], !!this.chosenQuestion() && matchScenarioByQuestion(this.chosenQuestion())?.id === scenario.id);
  }

  async retry(): Promise<void> {
    const scenario = this.demo.scenario() ?? scenarioById('countries-music-per-capita');
    if (scenario) await this.run(scenario, this.demo.question() || scenario.question[this.lang()], this.recognised);
  }

  askInsight(): void {
    this.demo.askInsight(this.lang());
    this.activeObservation.set(undefined);
  }

  showRows(observation: Observation): void {
    const same = this.activeObservation() === observation.id;
    this.activeObservation.set(same ? undefined : observation.id);
    this.pinned.set(same ? new Set() : new Set(observation.rowKeys));
  }

  clearPinned(): void { this.pinned.set(new Set()); this.activeObservation.set(undefined); }

  setLang(lang: DemoLang): void {
    this.lang.set(lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* A private window cannot remember the choice. */ }
  }

  signIn(): void {
    // The existing sign-in flow; it returns here afterwards. Keeping the investigation in an account is a later release.
    void this.router.navigate(['/login'], { fragment: '/demo' });
  }

  private async boot(): Promise<void> {
    this.lang.set(this.initialLang());
    const handoff = this.takeHandoff();
    if (handoff?.lang) this.setLang(handoff.lang);
    const override = (() => { try { return localStorage.getItem(DEMO_DATA_SOURCE_OVERRIDE_KEY); } catch { return null; } })();
    this.runtimeInfo.set(demoSourceRuntime(resolveDemoDataSource(this.config, override), location.origin));

    if (handoff && (handoff.scenario || handoff.question || handoff.unknownScenario)) {
      const scenario = scenarioById(handoff.scenario) ?? (handoff.question ? matchScenarioByQuestion(handoff.question) : undefined);
      if (scenario?.available) {
        const question = handoff.question ?? scenario.question[this.lang()];
        await this.run(scenario, question, !handoff.question || matchScenarioByQuestion(handoff.question)?.id === scenario.id);
        return;
      }
      this.chosenQuestion.set(handoff.question ?? '');
      this.notice.set(
        handoff.unknownScenario === 'custom' ? this.t('chooser.custom')
          : handoff.unknownScenario ? this.t('chooser.unknown', { scenario: handoff.unknownScenario })
            : scenario ? this.t('chooser.notYet')
              : this.t('chooser.questionNote'),
      );
      this.view.set('chooser');
      return;
    }
    try {
      if (await this.demo.restore()) { this.view.set('investigation'); return; }
    } catch { /* Stored data we cannot read is the same as none: start fresh. */ }
    this.notice.set(this.t('chooser.empty'));
    this.view.set('chooser');
  }

  private async run(scenario: DemoScenario, question: string, recognised: boolean): Promise<void> {
    this.recognised = recognised;
    this.liveRun = true;
    this.view.set('investigation');
    this.slow.set(false);
    this.pinned.set(new Set());
    this.activeObservation.set(undefined);
    const timer = setTimeout(() => { if (this.demo.phase() === 'running') this.slow.set(true); }, 4000);
    try {
      await this.demo.start(scenario, question, recognised, this.runtimeInfo());
    } finally {
      clearTimeout(timer);
      this.slow.set(false);
    }
  }

  /** The hand-off the app shell captured and stripped from the address bar, else the route's own query. */
  private takeHandoff(): DemoHandoff | undefined {
    const stored = storage((s) => s.getItem(DEMO_HANDOFF_STORAGE_KEY), null);
    if (stored !== null) storage((s) => s.removeItem(DEMO_HANDOFF_STORAGE_KEY), undefined);
    const fromRoute = this.route.snapshot.queryParamMap.keys.length ? `?${new URLSearchParams(Object.fromEntries(this.route.snapshot.queryParamMap.keys.map((key) => [key, this.route.snapshot.queryParamMap.get(key) ?? '']))).toString()}` : '';
    if (fromRoute) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    const search = stored || fromRoute;
    return search ? parseHandoff(search) : undefined;
  }

  private initialLang(): DemoLang {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'ru' || saved === 'en') return saved;
    } catch { /* No stored choice. */ }
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }
}
