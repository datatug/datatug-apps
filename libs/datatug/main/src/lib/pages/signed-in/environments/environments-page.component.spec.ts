import goldens from '../../../models/definition/environment-receipts.golden.json';
import {
  EnvironmentOperationRecoveryService,
  PendingEnvironmentOperation,
} from '../../../services/project/environment-operation-recovery.service';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import {
  EnvironmentsPageComponent,
  environmentManagementNote,
} from './environments-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { provideMockErrorLogger } from '../../../testing/error-logger.spec-helper';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { ProjectAssetsReadService } from '../../../services/project/project-assets-read.service';
import { ProjectEnvironmentStateService } from '../../../services/project/project-environment-state.service';
import {
  EnvironmentState,
  EnvironmentOperationResult,
} from '../../../models/definition/environment-state';
import { EnvironmentWrite } from '../../../models/definition/environment-receipt';
import { IEnvironmentFull } from '../../../models/definition/environments';

interface EnvironmentPageTestPort {
  recoveryReady(): boolean;
  editing(): boolean;
  message(): string;
  draft: { set(environments: readonly IEnvironmentFull[]): void };
  manage(): void;
  submit(kind: 'create' | 'order'): Promise<void>;
  retry(): Promise<void>;
  name: string;
  readonly unresolved: boolean;
}
function requiredGolden(kind: EnvironmentOperationResult['kind']) {
  const fixture = goldens.find(
    (item) => item.transport === 'cli' && item.receipt.kind === kind,
  );
  if (!fixture) throw new Error(`Missing CLI golden for ${kind}`);
  return {
    before: fixture.before as unknown as EnvironmentState,
    after: fixture.after as unknown as EnvironmentState,
    request: fixture.request as EnvironmentWrite,
    receipt: fixture.receipt as EnvironmentOperationResult,
  };
}

const focusEnvironmentInput = vi.fn();
const readyEnvironmentInput = vi.fn();
@Component({
  selector: 'sneat-environment-test-name-input',
  template: '<input aria-label="Environment name" />',
})
class EnvironmentNameInputStub {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  async getInputElement(): Promise<HTMLInputElement> {
    readyEnvironmentInput();
    await Promise.resolve();
    const input = this.host.nativeElement.querySelector('input');
    if (!input) throw new Error('Native input is not rendered');
    return input;
  }
  async setFocus(): Promise<void> {
    focusEnvironmentInput();
    this.host.nativeElement.querySelector('input')?.focus();
  }
}

const ref = { storeId: 'localhost:18989', projectId: 'demo' };
const state: EnvironmentState = {
  contract: 'environment-state/1',
  scope: { ...ref, authorityId: 'agent' },
  scopeBinding: 'a'.repeat(64),
  environments: [
    { id: 'prod', title: 'prod' },
    { id: 'local', title: 'local' },
  ],
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
  let stored: PendingEnvironmentOperation | undefined;
  const recovery = {
    read: vi.fn(async () => stored),
    reserve: vi.fn(async (operation: PendingEnvironmentOperation) => {
      stored = operation;
    }),
    attempt: vi.fn(async (operation: PendingEnvironmentOperation) => {
      stored = { ...operation, attempts: operation.attempts + 1 };
      return stored;
    }),
    remove: vi.fn(async () => {
      stored = undefined;
    }),
  };
  const api = {
    view: vi.fn(() => response),
    changed: vi.fn(),
    mutation: vi.fn<ProjectEnvironmentStateService['mutation']>(() => ({
      scope: state.scope,
      ifRevision: 'r1',
      operationId: 'op',
    })),
    save: vi.fn<ProjectEnvironmentStateService['save']>(),
    create: vi.fn<ProjectEnvironmentStateService['create']>(),
    read: vi.fn<ProjectEnvironmentStateService['read']>(),
    status: vi.fn<ProjectEnvironmentStateService['status']>(),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    stored = undefined;
    await TestBed.configureTestingModule({
      imports: [EnvironmentsPageComponent],
      providers: [
        provideMockErrorLogger(),
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
        { provide: EnvironmentOperationRecoveryService, useValue: recovery },
        { provide: DatatugNavService, useValue: nav },
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      ],
    })
      .overrideComponent(EnvironmentsPageComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          template: `@for (environment of environments(); track environment.id) { <button data-testid="environment-list-item" (click)="goEnvironment(environment)">{{presentation(environment).label}} {{presentation(environment).safetyLabel}}</button> }`,
        },
      })
      .compileComponents();
  });
  it('focuses the inline creation input after Angular render and Ionic native-input readiness', async () => {
    await TestBed.overrideComponent(EnvironmentsPageComponent, {
      set: {
        imports: [EnvironmentNameInputStub],
        template: `<button (click)="add()">Add environment</button>@if (creating()) { <sneat-environment-test-name-input #nameInput /> }`,
      },
    }).compileComponents();
    focusEnvironmentInput.mockClear();
    readyEnvironmentInput.mockClear();
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    fixture.detectChanges();
    response.next({ state, items: state.environments });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    expect(readyEnvironmentInput).toHaveBeenCalledOnce();
    expect(focusEnvironmentInput).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('input'),
    );
  });
  it('repaints asynchronously and preserves canonical custom order with compact safety metadata', async () => {
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    fixture.detectChanges();
    response.next({
      state,
      items: [
        {
          id: 'prod',
          title: 'prod',
          presentation: { label: 'Production', tone: 'danger' },
        },
        { id: 'local', title: 'local' },
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
      expect.objectContaining({ id: 'prod', title: 'prod' }),
    );
  });
  it('retains the exact operation after a lost save response and verifies real Go proof before closing', async () => {
    const golden = requiredGolden('save-environment-order');
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page =
      fixture.componentInstance as unknown as EnvironmentPageTestPort;
    api.mutation.mockReturnValue(golden.request);
    api.read.mockReturnValue(of(golden.before));
    response.next({
      state: golden.before,
      items: golden.before.environments,
    });
    await vi.waitFor(() => expect(page.recoveryReady()).toBe(true));
    page.manage();
    if (!('environmentOrder' in golden.request))
      throw new Error('Order golden must contain environmentOrder');
    page.draft.set(
      golden.request.environmentOrder.map((id) => {
        const environment = golden.before.environments.find(
          (row) => row.id === id,
        );
        if (!environment)
          throw new Error(`Golden order references missing environment ${id}`);
        return environment;
      }),
    );
    api.save.mockReturnValue(throwError(() => ({ status: 0 })));
    api.status.mockReturnValue(of({ ...golden.receipt, status: 'pending' }));
    await page.submit('order');
    expect(page.editing()).toBe(true);
    const original = api.save.mock.calls[0][1];
    if (!stored) throw new Error('Lost-response operation was not retained');
    expect(stored.request).toEqual(original);
    api.save.mockReturnValue(of(golden.receipt));
    api.read.mockReturnValue(of(golden.after));
    api.status.mockReturnValue(of(golden.receipt));
    await page.retry();
    expect(api.save.mock.calls[1][1]).toEqual(original);
    expect(page.editing()).toBe(false);
    expect(page.message()).toBe('Order saved.');
    expect(stored).toBeUndefined();
  });
  it('blocks fresh mutations when recovery storage cannot be read', async () => {
    recovery.read.mockRejectedValueOnce(new Error('storage denied'));
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page =
      fixture.componentInstance as unknown as EnvironmentPageTestPort;
    response.next({ state, items: state.environments });
    await vi.waitFor(() => expect(page.message()).toContain('storage'));
    page.name = 'Fresh';
    await page.submit('create');
    expect(api.create).not.toHaveBeenCalled();
    expect(page.recoveryReady()).toBe(false);
  });
  it('restores unresolved create before offering another mutation after route reentry', async () => {
    const golden = requiredGolden('create-environment');
    stored = {
      version: 1,
      actor: golden.before.scopeBinding,
      project: ref,
      before: golden.before,
      request: golden.request,
      attempts: 1,
    };
    api.read.mockReturnValue(of(golden.before));
    api.status.mockReturnValue(of({ ...golden.receipt, status: 'pending' }));
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page =
      fixture.componentInstance as unknown as EnvironmentPageTestPort;
    response.next({
      state: golden.before,
      items: golden.before.environments,
    });
    await vi.waitFor(() => expect(page.message()).toContain('unresolved'));
    if (!('name' in golden.request))
      throw new Error('Create golden must contain name');
    expect(page.name).toBe(golden.request.name);
    expect(page.unresolved).toBe(true);
    await page.submit('create');
    expect(api.create).not.toHaveBeenCalled();
  });
  it('does not allow mutations without the corresponding current capability', () => {
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page =
      fixture.componentInstance as unknown as EnvironmentPageTestPort;
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
  it('explains denied management with the agent reasons instead of offering controls', async () => {
    await TestBed.overrideComponent(EnvironmentsPageComponent, {
      set: {
        template: `@if (managementNote(); as note) { <p data-testid="environment-management-note">{{ note }}</p> }
          @if (recoveryReady() && state()?.capabilities?.canWriteOrder) { <button>Manage order</button> }
          @if (recoveryReady() && state()?.capabilities?.canCreateEnvironment) { <button>Add environment</button> }`,
      },
    }).compileComponents();
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    const page =
      fixture.componentInstance as unknown as EnvironmentPageTestPort;
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="environment-management-note"]',
      ),
    ).toBeNull();
    response.next({
      state: {
        ...state,
        capabilities: {
          canReadOrder: true,
          canWriteOrder: false,
          canCreateEnvironment: false,
          reasons: {
            canWriteOrder: 'The project folder is read-only.',
            canCreateEnvironment: 'The project folder is read-only.',
          },
        },
      },
      items: state.environments,
    });
    await vi.waitFor(() => expect(page.recoveryReady()).toBe(true));
    await fixture.whenStable();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="environment-management-note"]')
        ?.textContent.trim(),
    ).toBe('The project folder is read-only.');
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(0);
  });
  it.each([
    [undefined, ''],
    [state, ''],
    [
      {
        ...state,
        capabilities: {
          ...state.capabilities,
          canWriteOrder: false,
          reasons: { canWriteOrder: ' Order is locked. ' },
        },
      },
      'Order is locked.',
    ],
    [
      {
        ...state,
        capabilities: {
          canReadOrder: true,
          canWriteOrder: false,
          canCreateEnvironment: false,
          reasons: {
            canCreateEnvironment: 'Folder is read-only.',
            canWriteOrder: 'Order is locked.',
          },
        },
      },
      'Folder is read-only. Order is locked.',
    ],
    [
      {
        ...state,
        capabilities: {
          canReadOrder: true,
          canWriteOrder: false,
          canCreateEnvironment: false,
          // The exact reasons datatug-cli v0.113.0 sends without --allow-writes: no closing period.
          reasons: {
            canWriteOrder:
              'Environment metadata write grant and --allow-writes are required',
            canCreateEnvironment:
              'Environment create grant and --allow-writes are required',
          },
        },
      },
      'Environment create grant and --allow-writes are required. Environment metadata write grant and --allow-writes are required.',
    ],
    [
      {
        ...state,
        capabilities: { ...state.capabilities, canCreateEnvironment: false },
      },
      'Adding environments is unavailable for this project.',
    ],
  ])('environmentManagementNote(%#) is %j', (input, expected) => {
    expect(environmentManagementNote(input)).toBe(expected);
  });
});
