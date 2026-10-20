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
import { preserveCloudLogsReturnForAuthRecovery } from './cloud-logs-auth-return';

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
    currentUserId: ReturnType<typeof vi.fn>;
    isCurrentUser: ReturnType<typeof vi.fn>;
  };
  let currentUid: string;

  beforeEach(async () => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
    currentUid = 'test-user';
    accessState = new BehaviorSubject({ status: 'allowed' });
    access = {
      state: signal({ status: 'allowed' }),
      state$: accessState,
      retry: vi.fn(),
      currentUserId: vi.fn(() =>
        access.state().status === 'allowed' ? currentUid : undefined,
      ),
      isCurrentUser: vi.fn(
        (uid: string) => access.state().status === 'allowed' && currentUid === uid,
      ),
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
      receipt: 'R'.repeat(43),
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

  it('finishes a callback once across same-user access refreshes', async () => {
    const finishKey = 'A'.repeat(43);
    sessionStorage.setItem(
      'datatug:google-cloud-logs:finish-key',
      JSON.stringify({ uid: 'test-user', finishKey }),
    );
    window.__datatugTakeGoogleLogsReturn = () => ({
      status: 'complete',
      receipt: 'R'.repeat(43),
    });
    api.finishGoogleAuthorization.mockReturnValue(
      of({ id: 'grant-a', email: 'a@example.test', state: 'active' }),
    );

    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.notice()).toBe('Connected Google account a@example.test.');

    access.state.set({ status: 'checking' });
    accessState.next({ status: 'checking' });
    access.state.set({ status: 'allowed' });
    accessState.next({ status: 'allowed' });
    await fixture.whenStable();

    expect(api.finishGoogleAuthorization).toHaveBeenCalledOnce();
    expect(api.finishGoogleAuthorization).toHaveBeenCalledWith({
      receipt: 'R'.repeat(43),
      finishKey,
    });
  });

  it('does not finish a saved callback after a newer same-user attempt replaces its key', async () => {
    const original = { uid: 'test-user', finishKey: 'A'.repeat(43) };
    const newer = { uid: 'test-user', finishKey: 'B'.repeat(43) };
    sessionStorage.setItem(
      'datatug:google-cloud-logs:finish-key',
      JSON.stringify(original),
    );
    window.__datatugTakeGoogleLogsReturn = () => {
      delete window.__datatugTakeGoogleLogsReturn;
      return { status: 'complete', receipt: 'R'.repeat(43) };
    };
    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');
    sessionStorage.setItem(
      'datatug:google-cloud-logs:finish-key',
      JSON.stringify(newer),
    );

    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.finishGoogleAuthorization).not.toHaveBeenCalled();
    expect(component.notice()).toContain('did not complete');
    expect(
      JSON.parse(
        sessionStorage.getItem('datatug:google-cloud-logs:finish-key') ??
          'null',
      ),
    ).toEqual(newer);
  });

  it('does not let a stale finish delete the next user’s binding', async () => {
    const pending = new Subject<GoogleLogGrant>();
    sessionStorage.setItem(
      'datatug:google-cloud-logs:finish-key',
      JSON.stringify({ uid: 'test-user', finishKey: 'A'.repeat(43) }),
    );
    window.__datatugTakeGoogleLogsReturn = () => ({
      status: 'complete',
      receipt: 'R'.repeat(43),
    });
    api.finishGoogleAuthorization.mockReturnValue(pending);

    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
    expect(api.finishGoogleAuthorization).toHaveBeenCalledWith({
      receipt: 'R'.repeat(43),
      finishKey: 'A'.repeat(43),
    });

    access.state.set({ status: 'checking' });
    accessState.next({ status: 'checking' });
    currentUid = 'next-user';
    access.state.set({ status: 'allowed' });
    accessState.next({ status: 'allowed' });
    const nextBinding = JSON.stringify({
      uid: 'next-user',
      finishKey: 'B'.repeat(43),
    });
    sessionStorage.setItem(
      'datatug:google-cloud-logs:finish-key',
      nextBinding,
    );

    pending.next({ id: 'grant-a', email: 'a@example.test', state: 'active' });
    pending.complete();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.finishGoogleAuthorization).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem('datatug:google-cloud-logs:finish-key'),
    ).toBe(nextBinding);
    expect(component.grants()).toEqual([]);
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

  it('does not reactivate a denied view when its recovery query completes after selection changes', async () => {
    const pending = new Subject<PersonalLogQueryResult>();
    api.query
      .mockReturnValueOnce(throwError(() => ({ code: 'permission_denied' })))
      .mockReturnValueOnce(pending);
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    await component.runQuery();
    expect(component.selectedConnection()?.active).toBe(false);

    const retry = component.runQuery();
    component.selectConnection(connections[1]);
    pending.next({ entries: [], capped: false, morePossible: false });
    pending.complete();
    await retry;

    expect(component.selectedConnection()?.id).toBe('view-b');
    expect(component.selectedConnection()?.active).toBe(true);
    expect(component.connections().find((item) => item.id === 'view-a')?.active).toBe(false);
    expect(component.entries()).toEqual([]);
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

  it('retries the same query after IAM is repaired and restores the view only on success', async () => {
    api.list.mockReturnValue(of({ grants: [], connections }));
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
    component.selectConnection(connections[1]);
    const deniedConnection = component
      .connections()
      .find((item) => item.id === 'view-a');
    expect(deniedConnection?.active).toBe(false);
    fixture.detectChanges();
    const selectToRetry = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.connection ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent?.includes('Select to retry')) as HTMLElement;
    expect(selectToRetry).toBeDefined();
    selectToRetry.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Google denied Cloud Logging access to this view.',
    );
    const retry = fixture.nativeElement.querySelector(
      '.timeline ion-button',
    ) as HTMLElement;
    expect(retry?.textContent).toContain('Retry query');
    expect(component.selectedConnection()?.active).toBe(false);

    api.query.mockReturnValue(
      of({
        entries: [{ severity: 'ERROR', source: 'svc', message: 'recovered' }],
        capped: false,
        morePossible: false,
      }),
    );
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.query).toHaveBeenCalledTimes(2);
    expect(component.connections().find((item) => item.id === 'view-a')?.active).toBe(true);
    expect(component.selectedConnection()?.active).toBe(true);
    expect(component.entries()[0]?.message).toBe('recovered');
    expect(component.inactiveReason()).toBeNull();
  });

  it.each([
    ['throttled', 'Too many requests. Wait a moment and try again.'],
    ['unavailable', 'The Cloud Logging request failed. Try again shortly.'],
  ])('announces loading and %s errors when retrying an inactive view', async (code, message) => {
    const pending = new Subject<PersonalLogQueryResult>();
    api.query
      .mockReturnValueOnce(throwError(() => ({ code: 'permission_denied' })))
      .mockReturnValueOnce(pending);
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    await component.runQuery();
    fixture.detectChanges();

    const retry = fixture.nativeElement.querySelector(
      '.timeline ion-button',
    ) as HTMLElement;
    retry.click();
    fixture.detectChanges();

    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll(
          '.timeline [role="status"]',
        ) as NodeListOf<HTMLElement>,
      ).some((status) => status.textContent?.includes('Reading current entries…')),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('.timeline [role="alert"]'))
      .toBeNull();
    expect(fixture.nativeElement.querySelector('ag-grid-angular')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Ask a project administrator to grant the connected account permission',
    );

    pending.error({ code });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.timeline [role="alert"]')?.textContent)
      .toContain(message);
    expect(component.selectedConnection()?.active).toBe(false);
    expect(fixture.nativeElement.querySelector('ag-grid-angular')).toBeNull();
  });

  it('refreshes revocation status before reconnecting an expired grant and preserves its reason per view', async () => {
    const grant: GoogleLogGrant = {
      id: 'grant-a',
      email: 'investigator@example.test',
      state: 'active',
    };
    api.list
      .mockReturnValueOnce(of({ grants: [grant], connections }))
      .mockReturnValueOnce(of({
        grants: [{ ...grant, state: 'retired' as const, revocationConfirmed: true }],
        connections: [],
      }));
    api.disconnect.mockReturnValue(of({ state: 'revocation_pending' as const }));
    api.query.mockReturnValue(
      throwError(() => ({ code: 'reconnect_required' })),
    );
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    await component.runQuery();
    fixture.detectChanges();

    component.selectConnection(connections[1]);
    const expiredConnection = component
      .connections()
      .find((connection) => connection.id === 'view-a');
    expect(expiredConnection).toBeDefined();
    if (expiredConnection) component.selectConnection(expiredConnection);
    fixture.detectChanges();
    expect(component.inactiveReason()).toBe('reconnect_required');
    expect(fixture.nativeElement.textContent).toContain(
      'wait for cleanup to finish, then refresh connections and confirm it shows Disconnected',
    );

    const buttons = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('ion-button'),
      ) as HTMLElement[];
    buttons()
      .find((button) => button.textContent?.trim() === 'Revoke Google access')
      ?.click();
    fixture.detectChanges();
    buttons()
      .find((button) => button.textContent?.trim() === 'Confirm revocation')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.grantLabel(component.grants()[0])).toContain(
      'Cleanup is in progress',
    );

    buttons()
      .find((button) => button.textContent?.trim() === 'Refresh connections')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(component.grantLabel(component.grants()[0])).toBe('Disconnected');
    expect(component.connections()).toEqual([]);
    expect(component.selectedConnection()).toBeNull();
  });

  it('does not restore an inactive view when refresh removes it during a retry', async () => {
    const pending = new Subject<PersonalLogQueryResult>();
    api.query
      .mockReturnValueOnce(throwError(() => ({ code: 'permission_denied' })))
      .mockReturnValueOnce(pending);
    api.list
      .mockReturnValueOnce(of({ grants: [], connections }))
      .mockReturnValueOnce(of({ grants: [], connections: [] }));
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    await component.runQuery();
    fixture.detectChanges();

    const retry = fixture.nativeElement.querySelector(
      '.timeline ion-button',
    ) as HTMLElement;
    retry.click();
    fixture.detectChanges();
    const refresh = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent?.trim() === 'Refresh connections') as HTMLElement;
    refresh.click();
    await fixture.whenStable();
    pending.next({
      entries: [{ severity: 'ERROR', source: 'service', message: 'stale retry' }],
      capped: false,
      morePossible: false,
    });
    pending.complete();
    await fixture.whenStable();

    expect(component.selectedConnection()).toBeNull();
    expect(component.connections()).toEqual([]);
    expect(component.entries()).toEqual([]);
    expect(component.queryState()).toBe('idle');
  });

  it('rejects a query longer than 24 hours without calling the API', async () => {
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    component.fromTime.set('2026-01-01T00:00:00Z');
    component.toTime.set('2026-01-02T01:00:00Z');

    await component.runQuery();

    expect(api.query).not.toHaveBeenCalled();
    expect(component.queryError()).toBe('Choose a time range no longer than 24 hours.');
  });

  it('accepts the inclusive 24-hour query boundary', async () => {
    api.query.mockReturnValue(
      of({ entries: [], capped: false, morePossible: false }),
    );
    fixture = TestBed.createComponent(CloudLogsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectConnection(connections[0]);
    component.fromTime.set('2026-01-01T00:00:00Z');
    component.toTime.set('2026-01-02T00:00:00Z');

    await component.runQuery();

    expect(api.query).toHaveBeenCalledOnce();
    expect(component.queryState()).toBe('ready');
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

  it('explains the explicit revoke and new connection path for expired authorization', async () => {
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
      'Google authorization expired. DataTug cannot renew this grant in place.',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'wait for cleanup to finish, then refresh connections and confirm it shows Disconnected',
    );
    expect(fixture.nativeElement.querySelector('.timeline a[href="#accounts-heading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timeline ion-button')).toBeNull();
  });
});
