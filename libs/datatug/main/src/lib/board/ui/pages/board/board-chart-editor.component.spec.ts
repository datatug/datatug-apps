import { TestBed } from '@angular/core/testing';
import { of, Subject, Observable } from 'rxjs';
import { BoardChartEditorComponent } from './board-chart-editor.component';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryType, IQueryDef } from '../../../../models/definition/query-def';
import { ChartWidgetDef } from '@datatug/board-models';
const fields = {
  timeline: [
    'laneColumn',
    'eventColumn',
    'sequenceColumn',
    'timeColumn',
    'clockDomainColumn',
    'precisionColumn',
    'statusColumn',
    'evidenceRefColumn',
  ],
  heatmap: ['rowColumn', 'columnColumn', 'statusColumn', 'evidenceRefColumn'],
  'timing-bars': [
    'rowKeyColumn',
    'labelColumn',
    'startTimeColumn',
    'endTimeColumn',
    'startClockDomainColumn',
    'endClockDomainColumn',
    'startPrecisionColumn',
    'endPrecisionColumn',
    'startEvidenceRefColumn',
    'endEvidenceRefColumn',
    'startIdentityColumn',
    'endIdentityColumn',
  ],
};
function definition(): IQueryDef {
  return {
    id: 'events',
    title: 'Events',
    request: { queryType: QueryType.SQL },
    parameters: [{ id: 'order_id', type: 'integer', isRequired: true }],
    recordsets: [
      {
        name: 'events',
        columns: Array.from(new Set(Object.values(fields).flat())).map(
          (name) => ({ name, type: 'string' }),
        ),
      },
    ],
  };
}
describe('structured chart definition DOM', () => {
  afterEach(() => TestBed.resetTestingModule());
  it.each(['timeline', 'timing-bars', 'heatmap'] as const)(
    'authors %s with actual declared columns and a board input',
    async (kind) => {
      const getQuery = vi.fn(() => of(definition()));
      await TestBed.configureTestingModule({
        imports: [BoardChartEditorComponent],
        providers: [{ provide: QueriesService, useValue: { getQuery } }],
      }).compileComponents();
      const fixture = TestBed.createComponent(BoardChartEditorComponent);
      fixture.componentRef.setInput('project', {
        storeId: 'firestore',
        spaceID: 's',
        projectId: 'p',
      });
      fixture.componentRef.setInput('queries', [
        { id: 'shipping/events', title: 'Observed events' },
      ]);
      fixture.componentRef.setInput('boardParameters', [
        { id: 'order_id', type: 'integer', isRequired: true },
      ]);
      fixture.componentRef.setInput('card', {
        id: 'milestones',
        widget: { name: 'SQL', data: { sql: { queryId: 'shipping/events' } } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      const change = (name: string, value: string) => {
        const select = root.querySelector(
          `select[aria-label="${name}"]`,
        ) as HTMLSelectElement;
        expect(select).not.toBeNull();
        select.value = value;
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
      };
      change('Chart kind', kind);
      for (const role of fields[kind]) change(role, role);
      change('Board input for order_id', 'order_id');
      let saved: ChartWidgetDef | undefined;
      fixture.componentInstance.definition.subscribe(
        (value) => (saved = value),
      );
      const apply = root.querySelector('button') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();
      fixture.detectChanges();
      expect(saved?.chart.type).toBe(kind);
      expect(saved?.sources[0].parameters).toEqual([
        { id: 'order_id', boardParameterId: 'order_id' },
      ]);
      expect(getQuery).toHaveBeenCalledWith(
        { storeId: 'firestore', spaceID: 's', projectId: 'p' },
        'shipping/events',
      );
    },
  );
  it('displays persisted non-first mappings after async options load and drops constants when the saved query changes', async () => {
    const getQuery = vi.fn(() => of(definition()));
    await TestBed.configureTestingModule({
      imports: [BoardChartEditorComponent],
      providers: [{ provide: QueriesService, useValue: { getQuery } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardChartEditorComponent);
    fixture.componentRef.setInput('project', {
      storeId: 'firestore',
      spaceID: 's',
      projectId: 'p',
    });
    fixture.componentRef.setInput('queries', [
      { id: 'shipping/first' },
      { id: 'shipping/events' },
      { id: 'shipping/other' },
    ]);
    fixture.componentRef.setInput('card', {
      id: 'states',
      widget: {
        name: 'chart',
        data: {
          sources: [
            {
              id: 'held',
              queryId: 'shipping/events',
              parameters: [{ id: 'order_id', value: 11045 }],
            },
          ],
          chart: {
            type: 'heatmap',
            selectionId: 'states',
            heatmap: {
              rowColumn: 'statusColumn',
              columnColumn: 'rowColumn',
              statusColumn: 'columnColumn',
              evidenceRefColumn: 'evidenceRefColumn',
            },
          },
        },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const source = root.querySelector(
      'select[aria-label="Chart saved query"]',
    ) as HTMLSelectElement;
    expect(source.value).toBe('shipping/events');
    expect(source.selectedOptions[0]?.value).toBe('shipping/events');
    const row = root.querySelector(
      'select[aria-label="rowColumn"]',
    ) as HTMLSelectElement;
    expect(row.value).toBe('statusColumn');
    expect(row.selectedOptions[0]?.value).toBe('statusColumn');
    source.value = 'shipping/other';
    source.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    for (const role of fields.heatmap) {
      const select = root.querySelector(
        `select[aria-label="${role}"]`,
      ) as HTMLSelectElement;
      select.value = role;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }
    let saved: ChartWidgetDef | undefined;
    fixture.componentInstance.definition.subscribe((value) => (saved = value));
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(saved?.sources[0].queryId).toBe('shipping/other');
    expect(saved?.sources[0].parameters).toBeUndefined();
  });
  it('cancels held schema loading on scope change and never offers old protected columns', async () => {
    const pending = new Subject<IQueryDef>();
    let disposed = 0;
    const getQuery = vi.fn(
      () =>
        new Observable<IQueryDef>((subscriber) => {
          const subscription = pending.subscribe(subscriber);
          return () => {
            disposed++;
            subscription.unsubscribe();
          };
        }),
    );
    await TestBed.configureTestingModule({
      imports: [BoardChartEditorComponent],
      providers: [{ provide: QueriesService, useValue: { getQuery } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardChartEditorComponent);
    fixture.componentRef.setInput('project', {
      storeId: 'firestore',
      spaceID: 's',
      projectId: 'p',
    });
    fixture.componentRef.setInput('queries', [{ id: 'shipping/events' }]);
    fixture.componentRef.setInput('card', {
      id: 'milestones',
      widget: { name: 'SQL', data: { sql: { queryId: 'shipping/events' } } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('project', undefined);
    fixture.componentRef.setInput('scopeIdentity', 'other');
    fixture.detectChanges();
    await fixture.whenStable();
    pending.next(definition());
    fixture.detectChanges();
    expect(disposed).toBe(1);
    expect(fixture.componentInstance.columns()).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('select[aria-label="laneColumn"]'),
    ).toBeNull();
  });
});

it('loads and saves explicit elapsed anchor mapping and removes it when choosing calendar time', async () => {
  const query = definition();
  query.recordsets?.[0].columns.push({ name: 'anchor', type: 'integer' });
  await TestBed.configureTestingModule({
    imports: [BoardChartEditorComponent],
    providers: [
      { provide: QueriesService, useValue: { getQuery: () => of(query) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(BoardChartEditorComponent);
  fixture.componentRef.setInput('project', {
    storeId: 'github.com',
    projectId: 'o/r',
  });
  fixture.componentRef.setInput('queries', [{ id: 'shipping/events' }]);
  const mapping = Object.fromEntries(
    fields.timeline.map((role) => [role, role]),
  );
  fixture.componentRef.setInput('card', {
    id: 'milestones',
    widget: {
      name: 'chart',
      data: {
        sources: [{ id: 'events', queryId: 'shipping/events' }],
        chart: {
          type: 'timeline',
          selectionId: 'events',
          timeline: { ...mapping, timeMode: 'elapsed', anchorColumn: 'anchor' },
        },
      },
    },
  });
  await fixture.whenStable();
  const select = fixture.nativeElement.querySelector(
    'select[aria-label="Time axis"]',
  ) as HTMLSelectElement;
  expect(select.value).toBe('elapsed');
  expect(fixture.componentInstance.fields()).toContain('anchorColumn');
  const saved: ChartWidgetDef[] = [];
  fixture.componentInstance.definition.subscribe((value) => saved.push(value));
  fixture.componentInstance.apply();
  expect(saved[0].chart).toMatchObject({
    timeline: { timeMode: 'elapsed', anchorColumn: 'anchor' },
  });
  select.value = 'absolute';
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  fixture.componentInstance.apply();
  expect(saved[1].chart).not.toHaveProperty('timeline.anchorColumn');
  expect(saved[1].chart).not.toHaveProperty('timeline.timeMode');
  fixture.destroy();
});
