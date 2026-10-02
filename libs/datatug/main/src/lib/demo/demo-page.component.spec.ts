import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoInvestigationService, type DemoPhase } from './demo-investigation.service';
import { DemoPageComponent } from './demo-page.component';
import { DEMO_HANDOFF_STORAGE_KEY, scenarioById, type DemoScenario } from './demo-scenarios';
import { must } from './testing/must';

const dev = { enabled: true, dataSource: { kind: 'ovdb', baseUrl: 'http://127.0.0.1:50501' }, allowDataSourceOverride: true };

function mockInvestigation(restored = false) {
  return {
    phase: signal<DemoPhase>('idle'),
    question: signal(''),
    scenario: signal<DemoScenario | undefined>(undefined),
    steps: signal([]),
    rows: signal<readonly Record<string, unknown>[]>([]),
    populationYear: signal<number | undefined>(undefined),
    error: signal<string | undefined>(undefined),
    insight: signal(false),
    saveError: signal<string | undefined>(undefined),
    noAi: true,
    restore: vi.fn(async () => restored),
    start: vi.fn(async () => undefined),
    askInsight: vi.fn(),
    observations: vi.fn(() => []),
    discard: vi.fn(async () => undefined),
  };
}

describe('DemoPageComponent hand-off', () => {
  let fixture: ComponentFixture<DemoPageComponent>;
  let service: ReturnType<typeof mockInvestigation>;
  const router = { navigate: vi.fn(async () => true) };

  async function open(options: { stored?: string; query?: Record<string, string>; restored?: boolean } = {}): Promise<void> {
    sessionStorage.clear();
    localStorage.clear();
    if (options.stored !== undefined) sessionStorage.setItem(DEMO_HANDOFF_STORAGE_KEY, options.stored);
    service = mockInvestigation(options.restored);
    TestBed.configureTestingModule({
      imports: [DemoPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { demo: dev }, queryParamMap: convertToParamMap(options.query ?? {}) } } },
      ],
    }).overrideComponent(DemoPageComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [{ provide: DemoInvestigationService, useValue: service }] },
    });
    fixture = TestBed.createComponent(DemoPageComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const page = (): DemoPageComponent => fixture.componentInstance;
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => { TestBed.resetTestingModule(); router.navigate.mockClear(); });

  it('runs the saved plan for a valid scenario with the question as given, and consumes the stored hand-off', async () => {
    await open({ stored: '?scenario=countries-music-per-capita&q=Which+countries+buy+the+most+music+relative+to+their+population%3F&lang=en' });
    expect(service.start).toHaveBeenCalledTimes(1);
    const [scenario, question, recognised, runtime] = service.start.mock.calls[0] as unknown as [DemoScenario, string, boolean, { baseUrl: string }];
    expect(scenario.id).toBe('countries-music-per-capita');
    expect(question).toBe('Which countries buy the most music relative to their population?');
    expect(recognised).toBe(true);
    expect(runtime.baseUrl).toBe('http://127.0.0.1:50501');
    expect(sessionStorage.getItem(DEMO_HANDOFF_STORAGE_KEY)).toBeNull(); // a reload must not run it again
    expect(page().view()).toBe('investigation');
  });

  it('uses the scenario\'s own question when none was given, and says when wording was not matched', async () => {
    await open({ stored: '?scenario=sales-per-capita' });
    expect(service.start.mock.calls[0][1]).toBe(scenarioById('countries-music-per-capita')?.question.en);
    TestBed.resetTestingModule();
    await open({ stored: '?scenario=countries-music-per-capita&q=who+spends+most+on+tunes%3F' });
    expect(service.start.mock.calls[0][2]).toBe(false);
  });

  it('runs a question that matches the canonical wording even without a scenario', async () => {
    await open({ stored: '?q=Music+sales+per+capita+by+country' });
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('shows the question and the curated scenarios, and runs nothing, for an unknown scenario', async () => {
    await open({ stored: '?scenario=whatever&q=How+many+invoices+in+2012%3F' });
    expect(service.start).not.toHaveBeenCalled();
    expect(page().view()).toBe('chooser');
    expect(text()).toContain('How many invoices in 2012?');
    expect(page().notice()).toBe('“whatever” is not a scenario this demo knows.');
  });

  it('says what is true for custom, for a scenario that is not built yet, and for a question that matches nothing', async () => {
    await open({ stored: '?scenario=custom&q=hi' });
    expect(page().notice()).toContain('Free-form questions arrive in the next release');
    TestBed.resetTestingModule();
    await open({ stored: '?scenario=jazz-artists' });
    expect(page().notice()).toContain('not in this release yet');
    TestBed.resetTestingModule();
    await open({ stored: '?q=what+is+the+meaning+of+life' });
    expect(page().notice()).toContain('cannot answer arbitrary questions');
    expect(service.start).not.toHaveBeenCalled();
  });

  it('reads the route query when the shell captured nothing, and strips it from the address bar', async () => {
    await open({ query: { scenario: 'countries-music-per-capita', q: 'Which countries buy the most music relative to their population?' } });
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
  });

  it('restores the last investigation when there is no hand-off, else offers the chooser', async () => {
    await open({ restored: true });
    expect(page().view()).toBe('investigation');
    expect(service.start).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    await open({ restored: false });
    expect(page().view()).toBe('chooser');
    expect(page().notice()).toBe('Choose where to start.');
  });

  it('falls back to the chooser when stored data cannot be read', async () => {
    sessionStorage.clear();
    service = mockInvestigation();
    service.restore.mockRejectedValue(new Error('IndexedDB is blocked'));
    TestBed.configureTestingModule({
      imports: [DemoPageComponent],
      providers: [provideZonelessChangeDetection(), { provide: Router, useValue: router }, { provide: ActivatedRoute, useValue: { snapshot: { data: { demo: dev }, queryParamMap: convertToParamMap({}) } } }],
    }).overrideComponent(DemoPageComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [{ provide: DemoInvestigationService, useValue: service }] } });
    fixture = TestBed.createComponent(DemoPageComponent);
    await fixture.whenStable();
    expect(page().view()).toBe('chooser');
  });

  it('uses the language of the link, remembers it, and renders the page chrome in it', async () => {
    await open({ stored: '?scenario=custom&lang=ru&q=привет' });
    expect(page().lang()).toBe('ru');
    expect(localStorage.getItem('datatug.demo.lang.v1')).toBe('ru');
    expect(page().notice()).toContain('Произвольные вопросы');
    expect(text()).toContain('Демо DataTug');
    page().setLang('en');
    fixture.detectChanges();
    expect(text()).toContain('DataTug demo');
  });

  it('lets a visitor choose a scenario from the chooser', async () => {
    await open({ restored: false });
    await page().chooseScenario(must(scenarioById('countries-music-per-capita')));
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(page().view()).toBe('investigation');
  });

  it('retries the same question, and sign-in opens the existing login flow returning to the demo', async () => {
    await open({ stored: '?scenario=countries-music-per-capita&q=who+spends+most%3F' });
    service.scenario.set(scenarioById('countries-music-per-capita'));
    service.question.set('who spends most?');
    await page().retry();
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start.mock.calls[1][1]).toBe('who spends most?');
    page().signIn();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { fragment: '/demo' });
  });

  it('pins and clears the rows an observation rests on, and the follow-up asks the service once', async () => {
    await open({ restored: true });
    page().showRows({ id: 'a', message: { key: 'obs.leader', params: {} }, rowKeys: ['USA'] });
    expect([...page().pinned()]).toEqual(['USA']);
    expect(page().activeObservation()).toBe('a');
    page().showRows({ id: 'a', message: { key: 'obs.leader', params: {} }, rowKeys: ['USA'] });
    expect(page().pinned().size).toBe(0);
    page().askInsight();
    expect(service.askInsight).toHaveBeenCalledWith('en');
    page().clearPinned();
    expect(page().activeObservation()).toBeUndefined();
  });
});
