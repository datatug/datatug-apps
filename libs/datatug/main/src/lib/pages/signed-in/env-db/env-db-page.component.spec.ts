import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { EnvDbPageComponent } from './env-db-page.component';
import { ProjectService } from '../../../services/project/project.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';

describe('EnvDbPage', () => {
  let component: EnvDbPageComponent;
  let fixture: ComponentFixture<EnvDbPageComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { db: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [EnvDbPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: vi.fn() },
        },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
      ],
    })
      .overrideComponent(EnvDbPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvDbPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// Regression coverage for the fix in env-db-page.component.ts: `this.project` was
// never assigned from the route's project ref, so the tabulator rowClick handler's
// `if (!project || ...)` guard always bailed and a row click silently did nothing —
// found by S10's journey e2e (see e2e/journey/README.md "Known gap").
describe('EnvDbPage — project ref wiring', () => {
  let component: EnvDbPageComponent;
  let getFullMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { db: undefined } },
      writable: true,
      configurable: true,
    });
    getFullMock = vi.fn(() => of({}));
    await TestBed.configureTestingModule({
      imports: [EnvDbPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { watchProjectSummary: vi.fn(), getFull: getFullMock },
        },
        { provide: DatatugNavService, useValue: { goTable: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({
              get: (key: string) =>
                key === 'storeId'
                  ? 'localhost:8989'
                  : key === 'projectId'
                    ? 'demo-project'
                    : null,
            }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
      ],
    })
      .overrideComponent(EnvDbPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    component = TestBed.createComponent(EnvDbPageComponent).componentInstance;
  });

  it('sets project from the route project ref on ngOnInit', () => {
    component.ngOnInit();
    expect(component.project).toEqual({
      ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
      store: { ref: { type: 'agent', url: 'localhost:8989' } },
    });
    expect(getFullMock).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      projectId: 'demo-project',
    });
  });
});
