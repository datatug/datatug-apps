import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { ChatTurn } from '../chat/chat.types';
import { ChatSessionService, type ChatSession } from '../chat/chat-session.service';
import type { TraceStep } from '../chat/chat-trace.types';
import { FederatedQueryService } from '../queries/federated-query.service';
import { demoBundle, HERO_QUERY_ID, savedQuery, type DemoSourceRuntime } from './demo-project';
import { scenarioById, type DemoLang, type DemoScenario } from './demo-scenarios';
import { recordInsight } from './investigation/insight';
import { computeObservations, toPerCapitaRows, type Observation } from './investigation/observations';
import { defaultCollectionReader, runSavedPlan, usedNoAi, type DemoCollectionReader, type DemoQueryRunner } from './investigation/run-saved-plan';
import { TraceRecorder } from './trace/trace-recorder';

/** One demo investigation lives in one chat session of this scope; a new run replaces the previous one. */
export const DEMO_SCOPE = JSON.stringify(['demo', 'datatug-demo-project']);

/** How the trace's data checks read the sources. Tests replace it. */
export const DEMO_COLLECTION_READER = new InjectionToken<DemoCollectionReader>('Demo collection reader', { providedIn: 'root', factory: () => defaultCollectionReader });

export type DemoPhase = 'idle' | 'running' | 'done' | 'source-unavailable' | 'failed' | 'interrupted' | 'empty';

/** The query runner the app uses: the federated query worker, off the UI thread. */
@Injectable({ providedIn: 'root' })
export class WorkerDemoQueryRunner implements DemoQueryRunner {
  private readonly federated = inject(FederatedQueryService);

  async run(...[definition, runtime, hooks]: Parameters<DemoQueryRunner['run']>): ReturnType<DemoQueryRunner['run']> {
    try {
      return await this.federated.run(definition, hooks.onProgress, '', 'full', undefined, {
        ...(hooks.onSourceLoaded ? { onSourceLoaded: hooks.onSourceLoaded } : {}),
        ...(runtime.staticSource ? { staticSource: runtime.staticSource } : {}),
      });
    } finally {
      await this.federated.dispose().catch(() => undefined);
    }
  }
}

/**
 * Runs and stores the demo investigation. The question, the trace and the result are saved through the
 * chat session store (DALgo IndexedDB), step by step as they happen, so a reload restores them without
 * running anything again.
 */
@Injectable()
export class DemoInvestigationService {
  private readonly store = inject(ChatSessionService);
  private readonly runner = inject(WorkerDemoQueryRunner);
  private readonly reader = inject(DEMO_COLLECTION_READER);

  readonly phase = signal<DemoPhase>('idle');
  readonly question = signal('');
  readonly scenario = signal<DemoScenario | undefined>(undefined);
  readonly steps = signal<readonly TraceStep[]>([]);
  readonly rows = signal<readonly Record<string, unknown>[]>([]);
  readonly populationYear = signal<number | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly insight = signal<boolean>(false);
  readonly saveError = signal<string | undefined>(undefined);

  private recorder?: TraceRecorder;
  private persisting: Promise<void> = Promise.resolve();
  private generation = 0;

  get noAi(): boolean { return usedNoAi(this.steps()); }

  /** Restore the latest demo investigation, if there is one. Returns whether something was restored. */
  async restore(): Promise<boolean> {
    const sessions = (await this.store.list(DEMO_SCOPE)).filter((session) => session.kind === 'investigation');
    const latest = sessions.find((session) => session.turnIds.length > 0);
    if (!latest) return false;
    const { session, turns } = await this.store.load(DEMO_SCOPE, latest.id);
    const turn = turns[0];
    if (!turn) return false;
    const steps = await this.store.loadTrace(DEMO_SCOPE, session.id);
    this.question.set(turn.question);
    this.scenario.set(scenarioById(session.title.replace(/^scenario:/, '')));
    // A step still `running` in storage belonged to a run that was cut off.
    this.steps.set(steps.map((step) => step.status === 'running' ? { ...step, status: 'skipped' as const } : step));
    this.rows.set(turn.rows ?? []);
    const year = turn.rows?.[0]?.['populationYear'];
    this.populationYear.set(typeof year === 'number' ? year : undefined);
    this.recorder = this.newRecorder(session.id, turn.id, steps.length);
    this.error.set(turn.state === 'error' ? turn.error : undefined);
    this.insight.set(steps.some((step) => step.kind === 'insight'));
    this.phase.set(
      turn.state === 'result' ? 'done'
        : turn.state === 'empty' ? 'empty'
          : /interrupted/i.test(turn.error ?? '') ? 'interrupted'
            : steps.some((step) => step.status === 'failed') && /fetch|OVDB|static source|\(\d{3}\)|network/i.test(turn.error ?? '') ? 'source-unavailable' : 'failed',
    );
    return true;
  }

  /** Start a new investigation for a scenario, replacing the previous demo session. */
  async start(scenario: DemoScenario, question: string, recognised: boolean, runtime: DemoSourceRuntime): Promise<void> {
    await this.discard();
    const generation = this.generation;
    this.phase.set('running');
    this.scenario.set(scenario);
    this.question.set(question);
    this.steps.set([]);
    this.rows.set([]);
    this.insight.set(false);
    this.error.set(undefined);
    this.saveError.set(undefined);
    this.populationYear.set(undefined);

    let session: ChatSession;
    let turn: ChatTurn;
    try {
      session = await this.store.create(DEMO_SCOPE, 'investigation', `scenario:${scenario.id}`);
      turn = await this.store.appendQuestion(DEMO_SCOPE, session.id, question);
    } catch (error) {
      // No local storage (private mode, blocked): the demo still runs, it just cannot be restored.
      this.saveError.set(error instanceof Error ? error.message : 'Could not save this session.');
      session = { id: crypto.randomUUID(), scope: DEMO_SCOPE, title: '', createdAt: '', updatedAt: '', turnIds: [], queryIds: [], recordSetIds: [] };
      turn = { id: crypto.randomUUID(), question, state: 'loading' };
    }
    this.recorder = this.newRecorder(session.id, turn.id, 0);

    const outcome = await runSavedPlan({ scenario, recognised, question, runtime }, { runner: this.runner, reader: this.reader, recorder: this.recorder });
    if (generation !== this.generation) return;
    await this.persisting;
    if (outcome.state === 'failed') {
      this.error.set(outcome.reason);
      this.phase.set(outcome.failure === 'source-unavailable' ? 'source-unavailable' : 'failed');
      await this.save(() => this.store.failQuestion(DEMO_SCOPE, session.id, turn.id, outcome.reason));
      return;
    }
    this.rows.set(outcome.rows);
    if (outcome.populationYear !== undefined) this.populationYear.set(outcome.populationYear);
    const query = savedQuery(HERO_QUERY_ID, demoBundle);
    await this.save(() => this.store.completeQuery(DEMO_SCOPE, session.id, turn.id, {
      dtql: query.dtql, generatedDtql: '', dtqlYaml: query.dtql, sql: '', rows: outcome.rows, columns: outcome.columns,
      metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0, queryMs: outcome.queryMs }, source: `demo:${scenario.id}`,
    }));
    this.phase.set(outcome.state === 'empty' ? 'empty' : 'done');
  }

  /** The "What can you say about this data?" follow-up: computed from the rows, no AI. */
  askInsight(lang: DemoLang): void {
    const recorder = this.recorder;
    if (!recorder || this.insight() || !this.rows().length) return;
    recordInsight(recorder, this.rows(), lang);
    this.insight.set(true);
  }

  /** Observations for the stored rows, in the language now showing. */
  observations(lang: DemoLang): readonly Observation[] {
    return computeObservations(toPerCapitaRows(this.rows()), lang);
  }

  /** Forget the current investigation: the next run starts clean. */
  async discard(): Promise<void> {
    this.generation++;
    const sessions = await this.store.list(DEMO_SCOPE).catch((): readonly ChatSession[] => []);
    for (const session of sessions) await this.store.delete(DEMO_SCOPE, session.id).catch(() => undefined);
    this.recorder = undefined;
  }

  private newRecorder(sessionId: string, turnId: string, startIndex: number): TraceRecorder {
    const recorder = new TraceRecorder({
      sessionId, turnId,
      emit: (step, change) => {
        this.steps.update((steps) => change === 'append' ? [...steps, step] : steps.map((existing) => existing.id === step.id ? step : existing));
        if (this.saveError()) return;
        this.persisting = this.persisting
          .then(() => change === 'append' ? this.store.appendTraceStep(DEMO_SCOPE, step) : this.store.updateTraceStep(DEMO_SCOPE, step))
          .then(() => undefined)
          .catch((error: unknown) => { this.saveError.set(error instanceof Error ? error.message : 'Could not save the trace.'); });
      },
    });
    recorder.resume(startIndex);
    return recorder;
  }

  private async save(write: () => Promise<unknown>): Promise<void> {
    if (this.saveError()) return;
    try { await write(); } catch (error) { this.saveError.set(error instanceof Error ? error.message : 'Could not save this session.'); }
  }
}
