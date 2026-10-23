import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { IncidentComparePanelComponent } from './incident-compare-panel.component';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import type { CompareResult } from '../../../incidents/incident-compare';
import type {
  IncidentApiResult,
  IncidentDetail,
  IncidentRequestContext,
} from '../../../incidents/models';

const CONTEXT: IncidentRequestContext = {
  agentStoreId: 'url-agent:8989',
  scope: {
    storeId: 'ops',
    project: 'billing',
    environment: 'prod',
    securityContextId: 'ctx-1',
  },
};

const INCIDENT: IncidentDetail = {
  ref: { storeId: 'ops', incidentId: 'INC-1' },
  uid: 'uid-INC-1',
  title: 'Checkout errors spike',
  status: 'investigating',
  canonicalContext: { facts: [] },
  lastSeq: 2,
};

const RESULT: CompareResult = {
  left: {
    execution: {
      storeId: 'ops',
      projectId: 'billing',
      executionId: 'left-1',
    },
    executedAt: '2026-09-14T10:00:00Z',
    rowCount: 2,
    limitations: [
      { policy: 'row-filter', rowsFiltered: true, hiddenColumns: [] },
    ],
    reproducible: true,
  },
  right: {
    execution: {
      storeId: 'ops',
      projectId: 'billing',
      executionId: 'right-1',
    },
    executedAt: '2026-09-14T10:00:00Z',
    rowCount: 2,
    limitations: [],
    reproducible: true,
  },
  columns: [
    { name: 'id', type: 'string' },
    { name: 'status', type: 'string' },
  ],
  key: ['id'],
  added: [
    {
      key: [{ type: 'string', value: '3' }],
      row: [
        { type: 'string', value: '3' },
        { type: 'string', value: 'new' },
      ],
    },
  ],
  removed: [],
  changed: [
    {
      key: [{ type: 'string', value: '2' }],
      columns: [
        {
          column: 'status',
          left: { type: 'string', value: 'old' },
          right: { type: 'string', value: 'paid' },
        },
      ],
    },
  ],
  summary: {
    added: 1,
    removed: 0,
    changed: 1,
    unchanged: 1,
    columnsOnlyOnOneSide: [],
  },
  policyLimited: false,
  truncated: false,
};

describe('IncidentComparePanelComponent', () => {
  let fixture: ComponentFixture<IncidentComparePanelComponent>;
  let compareSpy: ReturnType<typeof vi.fn>;
  let compareRowsSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    compareSpy = vi.fn();
    compareRowsSpy = vi.fn().mockReturnValue(new Subject());
    await TestBed.configureTestingModule({
      imports: [IncidentComparePanelComponent],
      providers: [
        {
          provide: IncidentClientService,
          useValue: { compare: compareSpy, compareRows: compareRowsSpy },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(IncidentComparePanelComponent);
    fixture.componentRef.setInput('context', CONTEXT);
    fixture.componentRef.setInput('incident', INCIDENT);
    fixture.detectChanges();
  });

  it('posts affected vs control and paints summary tables after an async compare', async () => {
    const compare$ = new Subject<IncidentApiResult<CompareResult>>();
    compareSpy.mockReturnValue(compare$);
    fixture.componentInstance.queryId.set('customer-invoices');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="incident-compare-run"]',
      )?.disabled,
    ).toBeFalsy();
    fixture.componentInstance.run();

    expect(compareSpy).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({
        queryId: 'customer-invoices',
        left: expect.objectContaining({
          kind: 'facts',
          storeId: 'local',
          cohortRole: 'affected',
        }),
        right: expect.objectContaining({
          kind: 'facts',
          storeId: 'local',
          cohortRole: 'control',
        }),
        incident: INCIDENT.ref,
        mutationId: expect.any(String),
      }),
    );

    compare$.next({ kind: 'ok', data: RESULT });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Matching');
    expect(fixture.nativeElement.textContent).toContain('Changed');
    expect(fixture.nativeElement.textContent).toContain('paid');
    expect(fixture.nativeElement.textContent).toContain('row-filter');
    expect(fixture.nativeElement.textContent).not.toContain('Comparing…');
  });

  it('shows matching as a count when cached paging is unavailable', async () => {
    const compare$ = new Subject<IncidentApiResult<CompareResult>>();
    const rows$ = new Subject<IncidentApiResult<never>>();
    compareSpy.mockReturnValue(compare$);
    compareRowsSpy.mockReturnValue(rows$);
    fixture.componentInstance.queryId.set('customer-invoices');
    fixture.detectChanges();
    fixture.componentInstance.run();
    compare$.next({ kind: 'ok', data: RESULT });
    rows$.next({
      kind: 'unavailable',
      message: 'The incident store is not available on this server yet.',
    });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain(
      'this agent does not page cached matching rows',
    );
  });
});
