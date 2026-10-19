import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import {
  CloudLogsApiService,
  PersonalLogConnection,
  PersonalLogQueryResult,
} from './cloud-logs-api.service';
import { CloudLogsPageComponent } from './cloud-logs-page.component';

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

  beforeEach(async () => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
    api = {
      list: vi.fn(() => of({ grants: [], connections })),
      finishGoogleAuthorization: vi.fn(),
      query: vi.fn(),
      remove: vi.fn(() => of({ removed: true as const })),
      disconnect: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [CloudLogsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [{ provide: CloudLogsApiService, useValue: api }],
    })
      .overrideComponent(CloudLogsPageComponent, {
        set: { imports: [], template: '', schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  });

  afterEach(() => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
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
});
