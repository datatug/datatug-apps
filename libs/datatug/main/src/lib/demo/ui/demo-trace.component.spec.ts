import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DecisionMechanism, ProvenanceClass, TraceStep, TraceStepKind, TraceStatus } from '../../chat/chat-trace.types';
import { DEMO_MESSAGES } from '../trace/demo-messages';
import { DemoTraceComponent } from './demo-trace.component';

const KEYS: Record<TraceStepKind, string> = {
  understand: 'step.understand.recognised', 'select-tables': 'step.tables.ok', 'select-fields': 'step.tables.ok', 'resolve-meaning': 'step.meaning.ok',
  'need-source': 'step.need.ok', 'discover-source': 'step.need.ok', 'reconcile-identifiers': 'step.reconcile.ok', 'plan-join': 'step.execute.running',
  execute: 'step.execute.done', 'derive-metric': 'step.metric.ok', present: 'step.present.ok', 'follow-up': 'step.insight.ok', insight: 'step.insight.ok',
};

function step(index: number, kind: TraceStepKind, over: Partial<TraceStep> = {}): TraceStep {
  return {
    id: `t:${index}`, sessionId: 's', turnId: 't', index, kind, status: 'ok', startedAt: '2026-10-02T10:00:00Z', evidence: [],
    message: { key: KEYS[kind], params: { plan: 'Plan', tables: 11, matched: 24, total: 24, invoices: 412, aliases: 24, population: 216, rows: 24, count: 3 } },
    decision: { question: 'decision.plan', selected: [], mechanism: 'deterministic', provenance: 'declared', validatedBy: [] }, ...over,
  };
}

describe('DemoTraceComponent', () => {
  let fixture: ComponentFixture<DemoTraceComponent>;
  const html = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const items = (): HTMLElement[] => [...html().querySelectorAll<HTMLElement>('[data-testid="trace-step"]')];

  function render(steps: TraceStep[], inputs: { lang?: 'en' | 'ru'; noAi?: boolean; done?: boolean } = {}): void {
    TestBed.configureTestingModule({ imports: [DemoTraceComponent], providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(DemoTraceComponent);
    fixture.componentRef.setInput('steps', steps);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }
  beforeEach(() => TestBed.resetTestingModule());

  it('renders every step kind as a line with readable text from the dictionary, never a bare key', () => {
    const kinds = Object.keys(KEYS) as TraceStepKind[];
    render(kinds.map((kind, index) => step(index, kind)));
    expect(items().map((item) => item.getAttribute('data-kind'))).toEqual(kinds);
    for (const item of items()) {
      const text = item.querySelector('.text')?.textContent ?? '';
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\bstep\.\w+/);
      expect(text).not.toContain('{');
    }
  });

  it('shows every status with a mark and a text alternative, and a spinner while running', () => {
    const statuses: TraceStatus[] = ['ok', 'warning', 'failed', 'skipped', 'running'];
    render(statuses.map((status, index) => step(index, 'understand', { status })));
    expect(items().map((item) => item.getAttribute('data-status'))).toEqual(statuses);
    expect(items()[4].querySelector('ion-spinner')).not.toBeNull();
    expect(items()[1].querySelector('.mark')?.textContent?.trim()).toBe('!');
    expect(items()[2].querySelector('.sr')?.textContent).toContain('Failed');
  });

  it('marks a step whose service is not connected as a Preview without opening it', () => {
    render([step(0, 'resolve-meaning', { simulated: { reason: { key: 'step.meaning.simulated', params: {} } } }), step(1, 'present')]);
    expect(items()[0].querySelector('.preview')?.textContent).toContain('Preview');
    expect(items()[1].querySelector('.preview')).toBeNull();
  });

  it('has a distinct provenance glyph and label for every class, and a mechanism name for every mechanism', () => {
    const classes: ProvenanceClass[] = ['schema', 'declared', 'human-confirmed', 'observed', 'verified', 'inferred-from-data', 'ai-suggested', 'hypothesis'];
    render(classes.map((provenance, index) => step(index, 'understand', { decision: { question: 'decision.plan', selected: [], mechanism: 'deterministic', provenance, validatedBy: [] } })));
    const paths = items().map((item) => item.querySelector('sneat-datatug-demo-provenance path')?.getAttribute('d'));
    expect(new Set(paths).size).toBe(classes.length);
    classes.forEach((provenance, index) => expect(items()[index].querySelector('sneat-datatug-demo-provenance .sr')?.textContent).toBe(DEMO_MESSAGES.en[`provenance.${provenance}`]));
    for (const mechanism of ['deterministic', 'cached', 'jev', 'llm', 'human'] as DecisionMechanism[]) expect(DEMO_MESSAGES.en[`mechanism.${mechanism}`]).toBeTruthy();
  });

  it('opens a step to its evidence with the decision, the DTQL and the facts, and exposes the expanded state', () => {
    render([step(0, 'execute', {
      durationMs: 646,
      evidence: [
        { kind: 'query', ref: 'q', label: { key: 'step.execute.query', params: { id: 'q' } }, detail: { dtql: 'from:\n  name: Invoice' } },
        { kind: 'source', ref: 's', label: { key: 'step.execute.source', params: { source: 'chinook.Invoice', rows: 412, requests: 1 } }, detail: { ms: 41 } },
      ],
    })]);
    const button = items()[0].querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(items()[0].querySelector('sneat-datatug-demo-step-evidence')).toBeNull();
    expect(items()[0].querySelector('.ms')?.textContent).toContain('646 ms');
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const inspect = items()[0].querySelector('sneat-datatug-demo-step-evidence') as HTMLElement;
    expect(inspect.id).toBe(button.getAttribute('aria-controls'));
    expect(inspect.textContent).toContain('Which saved plan answers this question?');
    expect(inspect.textContent).toContain('Saved plan and fixed checks');
    expect(inspect.querySelector('pre')?.textContent).toBe('from:\n  name: Invoice');
    expect(inspect.textContent).toContain('chinook.Invoice: 412 rows read in 1 request');
    expect(inspect.textContent).toContain('41');
    button.click();
    fixture.detectChanges();
    expect(items()[0].querySelector('sneat-datatug-demo-step-evidence')).toBeNull();
  });

  it('renders in Russian, and says there was no AI only when the run is done and used none', () => {
    render([step(0, 'understand')], { lang: 'ru', noAi: true, done: false });
    expect(html().textContent).toContain('Как DataTug собрал ответ');
    expect(html().querySelector('[data-testid="no-ai"]')).toBeNull();
    fixture.componentRef.setInput('done', true);
    fixture.detectChanges();
    expect(html().querySelector('[data-testid="no-ai"]')?.textContent).toContain('0 токенов');
    fixture.componentRef.setInput('noAi', false);
    fixture.detectChanges();
    expect(html().querySelector('[data-testid="no-ai"]')).toBeNull();
  });
});
