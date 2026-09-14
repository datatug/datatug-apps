import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {
  AgentContextService,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, of } from 'rxjs';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentResolutionRecordPageComponent } from './incident-resolution-record-page.component';

describe('IncidentResolutionRecordPageComponent', () => {
  let fixture: ComponentFixture<IncidentResolutionRecordPageComponent>;
  let getSpy: ReturnType<typeof vi.fn>;
  let eventsSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(
      convertToParamMap({ storeId: 'ops', incidentId: 'INC-1' }),
    );
    const queryParamMap$ = new BehaviorSubject(
      convertToParamMap({
        agent: 'url-agent:8989',
        project: 'billing',
        environment: 'prod',
      }),
    );
    getSpy = vi.fn().mockReturnValue(
      of({
        kind: 'ok',
        data: {
          ref: { storeId: 'ops', incidentId: 'INC-1' },
          uid: 'uid-1',
          title: 'Checkout errors spike',
          status: 'investigating',
          canonicalContext: { facts: [] },
          lastSeq: 2,
        },
      }),
    );
    eventsSpy = vi.fn().mockReturnValue(
      of({
        kind: 'ok',
        data: [
          {
            cursor: 'cursor-status',
            event: {
              id: 'evt-status',
              seq: 2,
              at: '2026-09-13T08:00:00Z',
              visibleAt: '2026-09-13T08:00:00Z',
              incident: { storeId: 'ops', incidentId: 'INC-1' },
              actor: { kind: 'human', id: 'alex', via: 'web' },
              type: 'incident.status',
              assertion: { kind: 'claim' },
              payload: { status: 'investigating' },
            },
          },
        ],
      }),
    );

    await TestBed.configureTestingModule({
      imports: [IncidentResolutionRecordPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$,
            queryParamMap: queryParamMap$,
            snapshot: {
              paramMap: paramMap$.value,
              queryParamMap: queryParamMap$.value,
            },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: new BehaviorSubject(undefined),
            currentProject: new BehaviorSubject(undefined),
            currentEnv: new BehaviorSubject(undefined),
          },
        },
        {
          provide: AgentContextService,
          useValue: {
            contextFor: () => ({
              securityContextId: signal('ctx-current'),
              refresh: () => of({ securityContextId: 'ctx-current' }),
            }),
          },
        },
        {
          provide: InvestigationContextService,
          useValue: {
            setScope: vi.fn(),
            clear: vi.fn(),
            isCurrentScope: () => true,
          },
        },
        {
          provide: IncidentClientService,
          useValue: { get: getSpy, events: eventsSpy },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentResolutionRecordPageComponent);
    fixture.detectChanges();
  });

  it('cold-loads the same qualified incident and returns to it', () => {
    expect(getSpy).toHaveBeenCalledWith(
      {
        agentStoreId: 'url-agent:8989',
        scope: {
          storeId: 'ops',
          project: 'billing',
          environment: 'prod',
          securityContextId: 'ctx-current',
        },
      },
      'INC-1',
      undefined,
    );
    expect(eventsSpy).toHaveBeenCalled();
    expect(fixture.nativeElement.innerHTML).toContain('Resolution Record');
    expect(fixture.nativeElement.innerHTML).toContain('Checkout errors spike');
    expect(fixture.nativeElement.innerHTML).toContain(
      'Status is investigating.',
    );
    expect(
      (
        fixture.componentInstance as unknown as {
          detailUrl(): string;
        }
      ).detailUrl(),
    ).toContain('/incidents/ops/INC-1');
    expect(
      (
        fixture.componentInstance as unknown as {
          detailUrl(): string;
        }
      ).detailUrl(),
    ).not.toContain('/record');
    expect(
      (
        fixture.componentInstance as unknown as {
          detailCommands(): readonly string[];
        }
      ).detailCommands(),
    ).toEqual(['/incidents', 'ops', 'INC-1']);
  });
});
