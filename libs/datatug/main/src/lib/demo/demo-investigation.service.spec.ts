import 'fake-indexeddb/auto';
import { Injector, runInInjectionContext } from '@angular/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHAT_SESSION_DATABASE, ChatSessionService } from '../chat/chat-session.service';
import { DEMO_COLLECTION_READER, DemoInvestigationService, WorkerDemoQueryRunner } from './demo-investigation.service';
import { scenarioById } from './demo-scenarios';
import type { DemoQueryRunner } from './investigation/run-saved-plan';
import { staticReader, staticRunner, staticRuntime } from './testing/disk-static-source';
import { must } from './testing/must';

const scenario = must(scenarioById('countries-music-per-capita'));
const collections = ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks', 'ChatTraceSteps'];
let counter = 0;

function build(runner: DemoQueryRunner, name = `demo-service-${++counter}`, store?: Partial<ChatSessionService>): DemoInvestigationService {
  const database = new IndexedDbDatabase({ name, version: 3, collections });
  const real = runInInjectionContext(Injector.create({ providers: [{ provide: CHAT_SESSION_DATABASE, useValue: database }] }), () => new ChatSessionService());
  const injector = Injector.create({ providers: [
    { provide: ChatSessionService, useValue: store ? Object.assign(Object.create(real), store) : real },
    { provide: WorkerDemoQueryRunner, useValue: runner },
    { provide: DEMO_COLLECTION_READER, useValue: staticReader() },
    { provide: DemoInvestigationService, useClass: DemoInvestigationService, deps: [] },
  ] });
  return runInInjectionContext(injector, () => new DemoInvestigationService());
}

// The runner used here reads the real static data through the real federated executor.
describe('DemoInvestigationService', () => {
  beforeEach(() => undefined);

  it('runs, saves question, trace and result as it goes, and restores all of it in a new page load', async () => {
    const name = `demo-service-restore-${++counter}`;
    const first = build(staticRunner(), name);
    await first.start(scenario, 'Which countries buy the most music relative to their population?', true, staticRuntime());
    expect(first.phase()).toBe('done');
    expect(first.rows()).toHaveLength(24);
    expect(first.steps().map((step) => step.kind)).toHaveLength(9);
    expect(first.noAi).toBe(true);
    expect(first.populationYear()).toBe(2025);

    const reloaded = build(staticRunner(), name);
    expect(await reloaded.restore()).toBe(true);
    expect(reloaded.phase()).toBe('done');
    expect(reloaded.question()).toBe('Which countries buy the most music relative to their population?');
    expect(reloaded.scenario()?.id).toBe('countries-music-per-capita');
    expect(reloaded.rows()).toHaveLength(24);
    expect(reloaded.rows()[0]).toMatchObject({ country: 'Ireland' });
    expect(reloaded.steps().map((step) => [step.id.split(':')[1], step.kind, step.status])).toEqual(first.steps().map((step) => [step.id.split(':')[1], step.kind, step.status]));
    expect(reloaded.populationYear()).toBe(2025);
  });

  it('adds the follow-up to the same trace once, computed from the rows, and keeps it across a reload', async () => {
    const name = `demo-service-insight-${++counter}`;
    const service = build(staticRunner(), name);
    await service.start(scenario, 'q', true, staticRuntime());
    service.askInsight('en');
    service.askInsight('en');
    expect(service.insight()).toBe(true);
    expect(service.steps().filter((step) => step.kind === 'insight')).toHaveLength(1);
    expect(service.observations('en').map((observation) => observation.id)).toEqual(['largest-total', 'leader', 'small-countries']);
    const reloaded = build(staticRunner(), name);
    await reloaded.restore();
    expect(reloaded.insight()).toBe(true);
    expect(reloaded.steps().at(-1)?.kind).toBe('insight');
    // And a step added after a restore continues the numbering instead of overwriting.
    expect(reloaded.steps().map((step) => step.index)).toEqual([...reloaded.steps().keys()]);
  });

  it('a new run replaces the previous investigation', async () => {
    const name = `demo-service-replace-${++counter}`;
    const service = build(staticRunner(), name);
    await service.start(scenario, 'first', true, staticRuntime());
    await service.start(scenario, 'second', true, staticRuntime());
    const reloaded = build(staticRunner(), name);
    await reloaded.restore();
    expect(reloaded.question()).toBe('second');
    expect(reloaded.steps()).toHaveLength(9);
  });

  it('keeps a failed run: the failure, the steps so far and a way to retry survive a reload', async () => {
    const name = `demo-service-fail-${++counter}`;
    const down: DemoQueryRunner = { run: async () => { throw new TypeError('Failed to fetch'); } };
    const service = build(down, name);
    await service.start(scenario, 'q', true, staticRuntime());
    expect(service.phase()).toBe('source-unavailable');
    expect(service.rows()).toEqual([]);
    expect(service.steps().at(-1)).toMatchObject({ kind: 'execute', status: 'failed' });
    const reloaded = build(down, name);
    await reloaded.restore();
    expect(reloaded.phase()).toBe('source-unavailable');
    expect(reloaded.error()).toBeTruthy();
  });

  it('saves a failure before announcing it, so a reload the moment the message appears still restores it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saved: string[] = [];
    const store = { failQuestion: async () => { await gate; saved.push('failure'); return undefined; } };
    const service = build({ run: async () => { throw new TypeError('Failed to fetch'); } }, undefined, store as unknown as Partial<ChatSessionService>);
    const started = service.start(scenario, 'q', true, staticRuntime());
    for (let i = 0; i < 100 && !service.steps().some((step) => step.status === 'failed'); i++) await new Promise((done) => setTimeout(done, 20));
    await new Promise((done) => setTimeout(done, 50));
    expect(service.steps().some((step) => step.status === 'failed')).toBe(true);
    expect(service.phase()).toBe('running'); // not announced while the failure is still being saved
    release();
    await started;
    expect(saved).toEqual(['failure']);
    expect(service.phase()).toBe('source-unavailable');
  });

  it('a failure that is not about the source is a plain failure', async () => {
    const service = build({ run: async () => { throw new Error('join_aggregate exploded'); } });
    await service.start(scenario, 'q', true, staticRuntime());
    expect(service.phase()).toBe('failed');
  });

  it('an empty result is shown as empty', async () => {
    const empty: DemoQueryRunner = { run: async (definition, runtime, hooks) => {
      const result = await staticRunner().run(definition, runtime, hooks);
      return { ...result, recordset: { ...result.recordset, rows: [] } };
    } };
    const service = build(empty);
    await service.start(scenario, 'q', true, staticRuntime());
    expect(service.phase()).toBe('empty');
  });

  it('a run cut off by a reload is restored as interrupted, with its unfinished step no longer running', async () => {
    const name = `demo-service-interrupt-${++counter}`;
    let release: () => void = () => undefined;
    const hanging: DemoQueryRunner = { run: () => new Promise(() => undefined) };
    const service = build(hanging, name);
    void service.start(scenario, 'q', true, staticRuntime());
    await new Promise<void>((resolve) => { release = resolve; const poll = (): void => { if (service.steps().some((step) => step.kind === 'execute')) release(); else setTimeout(poll, 20); }; poll(); });
    await new Promise((done) => setTimeout(done, 100)); // let the writes land
    const reloaded = build(hanging, name);
    expect(await reloaded.restore()).toBe(true);
    expect(reloaded.phase()).toBe('interrupted');
    expect(reloaded.steps().some((step) => step.status === 'running')).toBe(false);
    expect(reloaded.steps().at(-1)).toMatchObject({ kind: 'execute', status: 'skipped' });
  });

  it('still runs when the browser will not store anything, and says nothing was saved', async () => {
    const refusing = { create: async () => { throw new Error('storage is blocked'); }, list: async () => [], delete: async () => undefined, appendTraceStep: async () => { throw new Error('storage is blocked'); } };
    const service = build(staticRunner(), undefined, refusing as unknown as Partial<ChatSessionService>);
    await service.start(scenario, 'q', true, staticRuntime());
    expect(service.phase()).toBe('done');
    expect(service.rows()).toHaveLength(24);
    expect(service.saveError()).toContain('blocked');
  });

  it('restores nothing when there is nothing stored', async () => {
    expect(await build(staticRunner()).restore()).toBe(false);
  });
});
