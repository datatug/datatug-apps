import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DetectiveClientService } from '../../detective/detective-client.service';
import { HostedBoardScope } from './hosted-board-scope';
@Component({
  template:
    '<p>{{scope.loading() ? "Loading" : scope.admitted() ? "Admitted" : "Choose environment"}}</p>',
  providers: [HostedBoardScope],
})
class ScopeHost {
  readonly scope = inject(HostedBoardScope);
}
describe('HostedBoardScope current admission', () => {
  it('requires an explicit environment and current native capability, and ignores delayed data after sign-out', async () => {
    const auth = new BehaviorSubject<unknown>({
      status: 'authenticated',
      user: { uid: 'sarah' },
    });
    const project = new BehaviorSubject({
      ref: { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
    });
    const params = new BehaviorSubject(convertToParamMap({}));
    const response = new Subject<unknown>();
    const client = { state: vi.fn(() => response) };
    await TestBed.configureTestingModule({
      imports: [ScopeHost],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: params,
            snapshot: { queryParamMap: params.value },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: project,
            currentEnv: new BehaviorSubject(undefined),
          },
        },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: AgentContextService, useValue: {} },
        { provide: DetectiveClientService, useValue: client },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ScopeHost);
    f.detectChanges();
    await f.whenStable();
    await vi.waitFor(() => expect(client.state).toHaveBeenCalledTimes(1));
    response.next({
      environments: ['demo'],
      capabilities: { canRead: true, canWrite: false },
    });
    response.complete();
    await f.whenStable();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Choose environment'),
    );
    expect(f.componentInstance.scope.environment()).toBe('');
    params.next(convertToParamMap({ environment: 'demo' }));
    await f.whenStable();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Admitted'),
    );
    expect(f.componentInstance.scope.canWrite()).toBe(false);
    const late = new Subject<unknown>();
    client.state.mockReturnValueOnce(late);
    f.componentInstance.scope.refresh();
    await f.whenStable();
    auth.next({ status: 'notAuthenticated' });
    await f.whenStable();
    late.next({
      environments: ['demo'],
      capabilities: { canRead: true, canWrite: true },
    });
    late.complete();
    await f.whenStable();
    expect(f.componentInstance.scope.state()).toBeUndefined();
    expect(f.componentInstance.scope.canWrite()).toBe(false);
    expect(f.nativeElement.textContent).toContain('Choose environment');
  });
  afterEach(() => TestBed.resetTestingModule());
});
