import { Component, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import {
  CloudLogsApiService,
  GoogleLogGrant,
  PersonalLogConnection,
  PersonalLogQueryResult,
} from './cloud-logs-api.service';
import { CloudLogsPageComponent } from './cloud-logs-page.component';
import { HostedCloudLogsAccessService } from './hosted-cloud-logs-access.service';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- models AG Grid inputs and row activation
  selector: 'ag-grid-angular',
  template: `@for (row of rowData(); track $index) {
    <button
      class="grid-entry"
      (click)="
        selectionChanged.emit({ api: { getSelectedRows: selectedRows(row) } })
      "
    >
      {{ row.message }}
    </button>
  }`,
})
class GridStubComponent {
  readonly rowData = input<Array<Record<string, unknown>>>([]);
  readonly columnDefs = input<unknown>();
  readonly defaultColDef = input<unknown>();
  readonly rowSelection = input<unknown>();
  selectedRows(row: Record<string, unknown>) {
    return () => [row];
  }
  readonly selectionChanged = output<unknown>();
  readonly gridReady = output<unknown>();
  readonly cellKeyDown = output<unknown>();
}

const connections: PersonalLogConnection[] = [
  {
    id: 'view-a',
    grantId: 'grant-a',
    projectId: 'project-a',
    logViewId: 'view-a',
    active: true,
  },
  {
    id: 'view-b',
    grantId: 'grant-b',
    projectId: 'project-b',
    logViewId: 'view-b',
    active: true,
  },
];

describe('CloudLogsPageComponent', () => {
  let fixture: ComponentFixture<CloudLogsPageComponent>;
  let component: CloudLogsPageComponent;
  let api: {
    list: ReturnType<typeof vi.fn>;
    finishGoogleAuthorization: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  let accessState: BehaviorSubject<{ status: string }>;
  let access: {
    state: ReturnType<typeof signal<{ status: string }>>;
    state$: BehaviorSubject<{ status: string }>;
    retry: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
    accessState = new BehaviorSubject({ status: 'allowed' });
    access = {
      state: signal({ status: 'allowed' }),
      state$: accessState,
      retry: vi.fn(),
    };
    api = {
      list: vi.fn(() => of({ grants: [], connections })),
      finishGoogleAuthorization: vi.fn(),
      query: vi.fn(),
      remove: vi.fn(() => of({ removed: true as const })),
      disconnect: vi.fn(),
    };
    TestBed.overrideComponent(CloudLogsPageComponent, {
      remove: { imports: [AgGridAngular] },
      add: { imports: [GridStubComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [CloudLogsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: CloudLogsApiService, useValue: api },
        { provide: HostedCloudLogsAccessService, useValue: access },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
  });

  it('clears connection and log data and ignores a stale list response after access changes', async () => {
    const pending = new Subject<{
      grants: GoogleLogGrant[];
      connections: PersonalLogConnection[];
    }>();
    api.list.mockReturnValue(pending);
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    access.state.set({ status: 'checking' });
    accessState.next({ status: 'checking' });
    pending.next({
      grants: [
        {
          id: 'old-user-grant',
          email: 'old-user@example.test',
          state: 'active',
        },
      ],
      connections: [connections[0]],
    });
    pending.complete();
    await fixture.whenStable();

    expect(component.grants()).toEqual([]);
    expect(component.connections()).toEqual([]);
    expect(component.selectedConnection()).toBeNull();
    expect(component.entries()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain(
      'old-user@example.test',
    );
  });

  it('finishes a replayed or new-tab callback without staying in loading state', async () => {
    window.__datatugTakeGoogleLogsReturn = () => ({
      status: 'complete',
      receipt: 'opaque-receipt',
    });
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.finishGoogleAuthorization).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledOnce();
    expect(component.pageState()).toBe('ready');
    expect(component.notice()).toContain('expired or was already used');
  });

  it('ignores a query response after the user selects another connection', async () => {
    const pending = new Subject<PersonalLogQueryResult>();
    api.query.mockReturnValue(pending);
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    const query = component.runQuery();
    component.selectConnection(connections[1]);
    pending.next({
      entries: [{ severity: 'ERROR', source: 'service', message: 'stale' }],
      capped: false,
      morePossible: false,
    });
    pending.complete();
    await query;

    expect(component.selectedConnection()?.id).toBe('view-b');
    expect(component.entries()).toEqual([]);
    expect(component.result()).toBeNull();
    expect(component.queryState()).toBe('idle');
  });

  it('ignores a late permission error after the selected view was removed', async () => {
    const pending = new Subject<PersonalLogQueryResult>();
    api.query.mockReturnValue(pending);
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    const query = component.runQuery();
    await component.removeView(connections[0]);
    pending.error({ code: 'permission_denied' });
    await query;

    expect(component.selectedConnection()).toBeNull();
    expect(component.queryState()).toBe('idle');
    expect(component.queryError()).toBe('');
  });

  it('announces empty account and view lists as status updates', async () => {
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const statuses = Array.from(
      fixture.nativeElement.querySelectorAll(
        '[role="status"]',
      ) as NodeListOf<Element>,
    ).map((element) => element.textContent?.trim());
    expect(statuses).toContain('No Google account is connected yet.');
    expect(statuses).toContain('No log views connected.');
  });

  it('does not revoke shared Google access when confirmation is canceled', async () => {
    const grants: GoogleLogGrant[] = [
      { id: 'grant-a', email: 'investigator@example.test', state: 'active' },
    ];
    api.list.mockReturnValue(of({ grants, connections: [connections[0]] }));
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('ion-button'),
      ) as HTMLElement[];
    buttons()
      .find((button) => button.textContent?.trim() === 'Revoke Google access')
      ?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'permissions for the shared Sneat app',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Use Remove view to disconnect just one log view.',
    );
    buttons()
      .find((button) => button.textContent?.trim() === 'Cancel')
      ?.click();
    fixture.detectChanges();

    expect(component.confirmGrantId()).toBe('');
    expect(api.disconnect).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('explains IAM permission failure without offering OAuth reconnect', async () => {
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    api.query.mockReturnValue(
      throwError(() => ({ code: 'permission_denied' })),
    );
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    fixture.detectChanges();
    await component.runQuery();
    fixture.detectChanges();

    expect(component.inactiveReason()).toBe('permission_denied');
    expect(fixture.nativeElement.textContent).toContain(
      'Ask a project administrator to grant the connected account permission',
    );
    expect(
      fixture.nativeElement.querySelector('.timeline ion-button'),
    ).toBeNull();
  });

  it('exposes entry disclosure state to assistive technology', async () => {
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    api.query.mockReturnValue(
      of({
        entries: [{ severity: 'ERROR', source: 'svc', message: 'failure' }],
        capped: false,
        morePossible: false,
      }),
    );
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    await component.runQuery();
    fixture.detectChanges();

    await fixture.whenStable();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('ag-grid-angular'),
      ).not.toBeNull();
    });
    expect(component.columns.map((column) => column.field)).toEqual([
      'timestamp',
      'severity',
      'service',
      'source',
      'message',
    ]);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    const setGridAriaProperty = vi.fn();
    component.nameGrid({
      api: { setGridAriaProperty },
    } as unknown as Parameters<typeof component.nameGrid>[0]);
    expect(setGridAriaProperty.mock.calls).toEqual([
      ['label', 'Cloud Logging entries'],
      ['describedby', 'cloud-log-grid-help'],
    ]);
    const setSelected = vi.fn();
    component.activateEntry({
      node: { setSelected },
      event,
    } as unknown as Parameters<typeof component.activateEntry>[0]);
    expect(setSelected).toHaveBeenCalledWith(true);
    component.selectionChanged({
      api: { getSelectedRows: () => component.entries() },
    } as unknown as Parameters<typeof component.selectionChanged>[0]);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(true);
    expect(
      fixture.nativeElement.querySelector('#cloud-entry-details')?.textContent,
    ).toContain('svc');
    component.queryError.set('Previous view error');
    component.selectConnection(connections[1]);
    expect(component.queryError()).toBe('');
  });

  it('offers OAuth reconnect for expired authorization', async () => {
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    api.query.mockReturnValue(
      throwError(() => ({ code: 'reconnect_required' })),
    );
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    fixture.detectChanges();
    await component.runQuery();
    fixture.detectChanges();

    expect(component.inactiveReason()).toBe('reconnect_required');
    expect(fixture.nativeElement.textContent).toContain(
      'Google authorization expired. Reconnect the Google account',
    );
    expect(
      fixture.nativeElement.querySelector('.timeline ion-button'),
    ).not.toBeNull();
  });
});
