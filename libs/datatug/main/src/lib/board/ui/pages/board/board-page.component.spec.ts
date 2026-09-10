import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { BoardPageComponent } from './board-page.component';
import { DatatugBoardService } from '../../../core/datatug-board.service';
import { ParameterLookupService } from '../../../../components/parameters/parameter-lookup.service';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';

describe('BoardPage', () => {
  let component: BoardPageComponent;
  let fixture: ComponentFixture<BoardPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugBoardService, useValue: { getBoard: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      .overrideComponent(BoardPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('BoardPage - currentProject navigation', () => {
  it('reads storeId/projectId from the project ref and requests the board', async () => {
    const logError = vi.fn();
    const getBoard = vi.fn().mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
        { provide: DatatugBoardService, useValue: { getBoard } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) => (key === routingParamBoard ? 'b1' : null),
            }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: { storeId: 's1', projectId: 'p1' },
            }),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      .overrideComponent(BoardPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    TestBed.createComponent(BoardPageComponent);

    // `getBoard()` was previously called with the literal string
    // 'http://localhost:8989' regardless of the project's actual store
    // (fixed, S136) — this asserts the real `storeId` ('s1', from
    // `currentProject`'s own `ref` above) flows through instead.
    expect(getBoard).toHaveBeenCalledWith('s1', 'p1', 'b1');
    expect(logError).not.toHaveBeenCalled();
  });
});
