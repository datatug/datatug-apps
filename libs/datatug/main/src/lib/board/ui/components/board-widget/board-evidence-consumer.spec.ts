import comparisonWire from '../../../../evidence/testdata/comparison-http.go.json';
import { readRetainedQueryResponse, heldEvidenceIdentity } from '../../../../evidence/retained-evidence-contract';
import { decodeQueryComparison } from '../../../../queries/query-comparison';
import coreComparison from '../../../../queries/testdata/core-v070-query-comparison.json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { Board, ChartWidgetDef } from '@datatug/board-models';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import {
  recordsetFingerprint,
  type Result,
  type TypedValue,
  type HeldEvidenceIdentity,
  type EvidenceInspection,
} from '@sneat/datatug-semantic';
import {
  BoardWidgetComponent,
  BoardResultSnapshot,
} from './board-widget.component';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryDispatchService } from '../../../../queries/query-dispatch.service';
import { QueryType } from '../../../../models/definition/query-def';
const board = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../../../board-models/src/lib/testdata/shipping-board.core-v063.json',
    ),
    'utf8',
  ),
) as Board;
const charts =
  board.rows
    ?.flatMap((row) => row.cards ?? [])
    .map((card) => card.widget?.data as ChartWidgetDef) ?? [];
const execution = {
  storeId: 'firestore',
  projectId: 'training',
  executionId: 'held-execution',
};
const scope = {
  storeId: 'firestore',
  spaceID: 'space',
  projectId: 'training',
  environment: 'demo',
};
const source = {
  id: 'shipping-working-copy',
  generation: 'retained-generation',
};
const identity: HeldEvidenceIdentity = {
  execution,
  scope,
  source,
  complete: true,
  hasMore: false,
};
async function held(): Promise<Result> {
  const values: Record<string, TypedValue> = {
    row_key: { type: 'string', value: 'request-row' },
    attempt_id: { type: 'string', value: 'attempt-1' },
    kind: { type: 'string', value: 'request-received' },
    sequence: { type: 'integer', value: '1' },
    occurred_at: { type: 'datetime', value: '2018-05-20T10:05:00Z' },
    clock_domain: { type: 'string', value: 'business-clock' },
    precision_ms: { type: 'integer', value: '1000' },
    status: { type: 'string', value: 'pass' },
    evidence_ref: { type: 'null', value: null },
    end_kind: { type: 'string', value: 'request-received' },
    start_at: { type: 'datetime', value: '2018-05-20T10:05:00Z' },
    end_at: { type: 'datetime', value: '2018-05-20T10:05:02Z' },
    start_event_id: { type: 'string', value: 'observed-start' },
    end_event_id: { type: 'string', value: 'observed-end' },
    start_evidence_ref: { type: 'null', value: null },
    end_evidence_ref: { type: 'null', value: null },
    request_id: { type: 'string', value: 'request-1' },
    expectation: { type: 'string', value: 'assignment' },
  };
  const recordset = {
    columns: Object.entries(values).map(([name, value]) => ({
      name,
      type: value.type === 'null' ? 'string' : value.type,
    })),
    rows: [Object.values(values)],
  };
  return {
    recordset,
    execution,
    truncated: false,
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: source.id,
      mode: 'live',
      observedAt: '2026-10-21T12:00:00Z',
      executionProfile: 'opaque-privileged',
    },
    rowEvidence: {
      version: 1,
      execution,
      recordsetFingerprint: await recordsetFingerprint(recordset),
      scope,
      source,
      rowKeyColumn: 'row_key',
      rows: [
        {
          rowKey: { type: 'string', value: 'request-row' },
          slots: Object.fromEntries(
            ['evidence_ref', 'start_evidence_ref', 'end_evidence_ref'].map(
              (name) => [
                name,
                {
                  state: 'available' as const,
                  refs: [{ kind: 'execution' as const, execution }],
                },
              ],
            ),
          ),
        },
      ],
    },
  };
}
describe('canonical Board evidence-chart consumer', () => {
  afterEach(() => TestBed.resetTestingModule());
  async function mount(
    data: ChartWidgetDef,
    profile: 'datatug' | 'dashboardius' = 'datatug',
    comparative = false,
  ) {
    const run = vi.fn(),
      auth = new BehaviorSubject({
        status: 'authenticated',
        user: { uid: 'sarah' },
      });
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES[profile] },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: QueriesService,
          useValue: {
            getQuery: () =>
              of({
                id: data.sources[0].queryId.split('/').at(-1),
                request: {
                  queryType: QueryType.SQL,
                  text: 'select actual_saved_query',
                },
                connectionId: 'shipping',
                ...(comparative ? { comparison: coreComparison.comparison } : {}),
                recordsets: [],
              }),
          },
        },
        {
          provide: QueryDispatchService,
          useValue: {
            execute: run,
            runtimeRevision: signal(0),
            availableWorkingCopies: async () => [],
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardWidgetComponent),
      snapshot = signal<BoardResultSnapshot | undefined>(undefined);
    fixture.componentRef.setInput('projectRef', {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'training',
    });
    fixture.componentRef.setInput('boardId', 'shipping');
    fixture.componentRef.setInput('cardId', 'chart');
    fixture.componentRef.setInput('boardContext', { environment: 'demo' });
    fixture.componentRef.setInput('widgetDef', { name: 'chart', data });
    fixture.componentRef.setInput('resultSnapshot', snapshot);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, snapshot, run };
  }
  it.each(['datatug', 'dashboardius'] as const)(
    'renders the same three canonical variants and exact held grid under %s',
    async (profile) => {
      for (const data of charts) {
        const { fixture, snapshot, run } = await mount(data, profile);
        const result = await held();
        snapshot.set({
          queryId: data.sources[0].queryId,
          result,
          identity: fixture.componentInstance.executionIdentity(),
          evidenceIdentity: identity,
        });
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() =>
          expect(fixture.componentInstance.preparedEvidence()?.kind).toBe(data.chart.type),
        );
        expect(fixture.componentInstance.preparingEvidence()).toBe(false);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(fixture.componentInstance.evidenceError()).toBeNull();
        expect(fixture.componentInstance.unsupportedReason()).toBeUndefined();
        expect(fixture.componentInstance.definition()?.id).toBe(data.sources[0].queryId.split('/').at(-1));
        expect(
          fixture.nativeElement.querySelector('datatug-evidence-chart table'),
        ).not.toBeNull();
        expect(fixture.componentInstance.preparedEvidence()?.kind).toBe(
          data.chart.type,
        );
        const emitted: EvidenceInspection[] = [];
        fixture.componentInstance.inspectEvidence.subscribe((value) =>
          emitted.push(value),
        );
        const buttons = Array.from(
          fixture.nativeElement.querySelectorAll(
            'datatug-evidence-chart tbody button',
          ),
        ) as HTMLButtonElement[];
        expect(buttons.length).toBe(data.chart.type === 'timing-bars' ? 2 : 1);
        for (const button of buttons) button.click();
        expect(emitted.map((value) => value.selector.slotColumn)).toEqual(
          data.chart.type === 'timing-bars'
            ? ['start_evidence_ref', 'end_evidence_ref']
            : ['evidence_ref'],
        );
        for (const value of emitted) {
          expect(value.selector.execution).toEqual(execution);
          expect(value.selector.recordsetFingerprint).toBe(
            result.rowEvidence?.recordsetFingerprint,
          );
          expect(value.selector.rowKey).toEqual({
            type: 'string',
            value: 'request-row',
          });
        }
        expect(run).not.toHaveBeenCalled();
        fixture.destroy();
        TestBed.resetTestingModule();
      }
    },
  );
  it.each(['datatug','dashboardius'] as const)('renders admitted aliased pair caption and exact Inspect under %s',async profile=>{
    const p=comparisonWire.run.comparison.declaration.projection;
    const data={...charts[0], title:'Request processing', sources:[{...charts[0].sources[0],queryId:comparisonWire.request.queryId}], chart:{type:'timeline' as const, selectionId:'actual-comparison', timeline:{laneColumn:p.laneColumn,eventColumn:p.eventColumn,sequenceColumn:p.sequenceColumn,timeColumn:p.timeColumn,clockDomainColumn:p.clockDomainColumn,precisionColumn:p.precisionColumn,statusColumn:p.statusColumn,anchorColumn:p.anchorColumn,timeMode:'elapsed' as const,evidenceRefColumn:'evidence_ref'}}};
    const {fixture,snapshot,run}=await mount(data,profile,true);
    const scope={projectRef:{storeId:'firestore',spaceID:comparisonWire.request.spaceID,projectId:comparisonWire.request.project},environment:comparisonWire.request.environment,actor:'actor'};
    fixture.componentRef.setInput('projectRef',scope.projectRef);
    const response=await readRetainedQueryResponse(comparisonWire.run,scope,comparisonWire.request.queryId,{incidentRef:comparisonWire.run.attachedIncidentRef},{declaration:decodeQueryComparison(comparisonWire.request.comparison),inputs:comparisonWire.request.inputs});
    snapshot.set({queryId:comparisonWire.request.queryId,result:response.result,identity:fixture.componentInstance.executionIdentity(),evidenceIdentity:heldEvidenceIdentity(response,scope)});
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Request processing · 11038 vs 11045');
    expect(fixture.componentInstance.evidenceError()).toBeNull();
    await vi.waitFor(()=>expect(fixture.componentInstance.preparedEvidence()?.rows.length).toBe(9));
    await fixture.whenStable();
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['missing-control','missing-start','wrong-mapping'] as const)('keeps the exact held table when comparison presentation has %s',async mode=>{
    const wire=structuredClone(comparisonWire.run),p=wire.comparison.declaration.projection;
    const names=wire.result.recordset.columns.map(c=>c.name);
    if(mode==='missing-control'){
      wire.result.recordset.rows=wire.result.recordset.rows.filter(row=>row[names.indexOf(p.memberColumn)].value==='11045');
      const keys=wire.result.recordset.rows.map(row=>row[names.indexOf(p.observationColumn)].value);
      wire.result.rowEvidence.rows=wire.result.rowEvidence.rows.filter(row=>keys.includes(row.rowKey.value));
    }
    if(mode==='missing-start')for(const row of wire.result.recordset.rows)row[names.indexOf(p.anchorColumn)].value='0';
    wire.result.rowEvidence.recordsetFingerprint=await recordsetFingerprint(wire.result.recordset as Result['recordset']);
    const data={...charts[0],title:'Request processing',sources:[{...charts[0].sources[0],queryId:comparisonWire.request.queryId}],chart:{type:'timeline' as const,selectionId:'held-unavailable',timeline:{laneColumn:p.laneColumn,eventColumn:mode==='wrong-mapping'?'artifact':p.eventColumn,sequenceColumn:p.sequenceColumn,timeColumn:p.timeColumn,clockDomainColumn:p.clockDomainColumn,precisionColumn:p.precisionColumn,statusColumn:p.statusColumn,anchorColumn:p.anchorColumn,timeMode:'elapsed' as const,evidenceRefColumn:'evidence_ref'}}};
    const {fixture,snapshot,run}=await mount(data,'datatug',true);
    const scope={projectRef:{storeId:'firestore',spaceID:comparisonWire.request.spaceID,projectId:comparisonWire.request.project},environment:comparisonWire.request.environment,actor:'actor'};
    fixture.componentRef.setInput('projectRef',scope.projectRef);
    const response=await readRetainedQueryResponse(wire,scope,comparisonWire.request.queryId,{incidentRef:wire.attachedIncidentRef},{declaration:decodeQueryComparison(comparisonWire.request.comparison),inputs:comparisonWire.request.inputs});
    snapshot.set({queryId:comparisonWire.request.queryId,result:response.result,identity:fixture.componentInstance.executionIdentity(),evidenceIdentity:heldEvidenceIdentity(response,scope)});
    await vi.waitFor(()=>expect(fixture.componentInstance.evidenceError()).toMatch(mode==='missing-control'?/no observed data/:mode==='missing-start'?/No observed start/:/mappings/));
    await fixture.whenStable();
    expect(fixture.componentInstance.preparedEvidence()).toBeNull();
    expect(fixture.nativeElement.querySelector('sneat-datatug-held-result-presentation')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('attempt-11045-1-e4');
    expect(fixture.componentInstance.result()?.recordset.rows).toEqual(wire.result.recordset.rows);
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps declared comparisons unavailable without retained pair admission while exposing the exact held table', async () => {
    const data = charts[0], { fixture, snapshot, run } = await mount(data, 'datatug', true);
    const result = await held();
    snapshot.set({ queryId: data.sources[0].queryId, result, identity: fixture.componentInstance.executionIdentity(), evidenceIdentity: identity });
    await fixture.whenStable();
    expect(fixture.componentInstance.preparedEvidence()).toBeNull();
    expect(fixture.componentInstance.evidenceError()).toContain('verified comparison');
    expect(fixture.nativeElement.querySelector('sneat-datatug-held-result-presentation')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('request-row');
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { environment: 'other', securityContextId: 'original' },
    { environment: 'demo', securityContextId: 'replacement' },
    { environment: 'demo' },
  ])('refuses missing expected source identity, forged sidecars, and fences context change %j', async (context) => {
    const data = charts[1],
      { fixture, snapshot, run } = await mount(data);
    fixture.componentRef.setInput('boardContext', { environment: 'demo', securityContextId: 'original' });
    const result = await held();
    const write = (value: Result, expected?: HeldEvidenceIdentity) =>
      snapshot.set({
        queryId: data.sources[0].queryId,
        result: value,
        identity: fixture.componentInstance.executionIdentity(),
        ...(expected ? { evidenceIdentity: expected } : {}),
      });
    write(result);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.evidenceError()).toContain(
      'source identity',
    );
    if (!result.rowEvidence) throw new Error('fixture');
    write(
      {
        ...result,
        rowEvidence: {
          ...result.rowEvidence,
          recordsetFingerprint: '0'.repeat(64),
        },
      },
      identity,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.preparedEvidence()).toBeNull();
    write(result, identity);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.preparingEvidence()).toBe(false),
    );
    expect(fixture.componentInstance.evidenceError()).toBeNull();
    expect(fixture.componentInstance.preparedEvidence()).not.toBeNull();
    const selection =
      fixture.componentInstance.preparedEvidence()?.rows[0].inspections[0];
    if (!selection) throw new Error('fixture');
    const emit = vi.fn();
    fixture.componentInstance.inspectEvidence.subscribe(emit);
    fixture.componentRef.setInput('boardContext', context);
    fixture.componentInstance.inspectHeldEvidence(selection);
    expect(emit).not.toHaveBeenCalled();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.preparedEvidence()).toBeNull();
    expect(
      fixture.nativeElement.querySelector('datatug-evidence-chart table'),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
