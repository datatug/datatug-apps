import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { EnvironmentsPageComponent } from './environments-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { ProjectAssetsReadService } from '../../../services/project/project-assets-read.service';
import { ProjectEnvironmentStateService } from '../../../services/project/project-environment-state.service';
import { EnvironmentState } from '../../../models/definition/environment-state';

const ref = { storeId: 'localhost:18989', projectId: 'demo' };
const state: EnvironmentState = {
  contract: 'environment-state/1',
  scope: { ...ref, authorityId: 'agent' },
  scopeBinding: 'a'.repeat(64),
  environments: [{ id: 'prod' }, { id: 'local' }],
  savedOrder: ['prod', 'local'],
  order: ['prod', 'local'],
  revision: 'r1',
  needsRepair: false,
  capabilities: {
    canReadOrder: true,
    canWriteOrder: true,
    canCreateEnvironment: true,
  },
};

describe('Environments management', () => {
  const project = new BehaviorSubject({ ref });
  const response = new Subject<{
    state: EnvironmentState;
    items: EnvironmentState['environments'];
  }>();
  const nav = { goEnvironment: vi.fn() };
  const api = {
    view: vi.fn(() => response),
    mutation: vi.fn(() => ({
      scope: state.scope,
      ifRevision: 'r1',
      operationId: 'op',
    })),
    save: vi.fn(),
    create: vi.fn(),
    read: vi.fn(),
    status: vi.fn(),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [EnvironmentsPageComponent],
      providers: [
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'u1' } }),
          },
        },
        {
          provide: ProjectAssetsReadService,
          useValue: { legacyEnvironments: vi.fn() },
        },
        { provide: ProjectEnvironmentStateService, useValue: api },
        { provide: DatatugNavService, useValue: nav },
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      ],
    })
      .overrideComponent(EnvironmentsPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  });
  it('repaints asynchronously and preserves canonical custom order with compact safety metadata', async () => {
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    fixture.detectChanges();
    response.next({
      state,
      items: [
        { id: 'prod', presentation: { label: 'Production', tone: 'danger' } },
        { id: 'local' },
      ],
    });
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="environment-list-item"]',
    );
    expect(rows[0].textContent).toContain('Production');
    expect(rows[0].textContent).toContain('High caution');
    expect(rows[0].getAttribute('color')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('ion-card h2')).toHaveLength(
      0,
    );
    rows[0].click();
    expect(nav.goEnvironment).toHaveBeenCalledWith(
      { ref },
      expect.objectContaining({ id: 'prod' }),
    );
  });
  it('retains the exact operation after a lost save response and confirms canonical order before closing', () => {
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page = fixture.componentInstance as any;
    response.next({ state, items: state.environments });
    page.manage();
    page.move(0, 1);
    api.save.mockReturnValue(throwError(() => ({ status: 0 })));
    api.read.mockReturnValue(throwError(() => ({ status: 503 })));
    api.status.mockReturnValue(of({ operationId: 'op', status: 'pending' }));
    page.submit('order');
    expect(page.editing()).toBe(true);
    const original = api.save.mock.calls[0][1];
    api.save.mockReturnValue(of({ operationId: 'op' }));
    api.read.mockReturnValue(
      of({
        ...state,
        order: ['local', 'prod'],
        environments: [{ id: 'local' }, { id: 'prod' }],
      }),
    );
    api.status.mockReturnValue(
      of({
        operationId: 'op',
        status: 'committed',
        environmentOrder: ['local', 'prod'],
      }),
    );
    page.retry();
    expect(api.save.mock.calls[1][1]).toBe(original);
    expect(page.editing()).toBe(false);
    expect(page.message()).toBe('Order saved.');
  });
  it('does not allow mutations without the corresponding current capability', () => {
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page = fixture.componentInstance as any;
    response.next({
      state: {
        ...state,
        capabilities: {
          canReadOrder: true,
          canWriteOrder: false,
          canCreateEnvironment: false,
        },
      },
      items: state.environments,
    });
    page.name = 'New';
    page.submit('create');
    page.submit('order');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });
});
