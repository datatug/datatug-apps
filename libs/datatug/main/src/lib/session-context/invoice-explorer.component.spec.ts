import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SessionWorkspaceService } from './session-workspace.service';
import { SessionChinookQueryService } from './session-chinook-query.service';
import { InvoiceExplorerComponent } from './invoice-explorer.component';
import { ContextSnapshot } from './session-context-contract';

const scope = { environmentId: 'test', identityDomain: 'local-test' };
function snapshot(id: string): ContextSnapshot {
  return {
    session: { schemaVersion: 1, id, databaseId: 'db', projectId: 'project', owner: 'actor', title: id,
      state: 'active', version: 1, defaultBagId: 'bag', contextSetId: 'set', bagIds: ['bag'], createdAt: '', updatedAt: '' },
    bags: [{ id: 'bag', sessionId: id, title: 'Test', scope, version: 1, entryIds: [] }], entries: [], revisions: [],
    contextSet: { id: 'set', sessionId: id, enabled: false, slots: [], createdAt: '' },
  };
}

describe('InvoiceExplorerComponent source dispatch boundary', () => {
  it('does not query on construction, session reload, or context changes; only explicit Refresh dispatches', async () => {
    const snapshots = signal<Readonly<Record<string, ContextSnapshot>>>({ s1: snapshot('s1'), s2: snapshot('s2') });
    const workspace = {
      snapshotFor: (id: string) => snapshots()[id], canExecuteFor: () => true,
      capabilities: () => ({ subjects: [] }),
    } as unknown as SessionWorkspaceService;
    const query = { execute: vi.fn(async () => ({ rows: [], columns: [] })) };
    const params = new BehaviorSubject<{ get: (key: string) => string | null }>({ get: (key: string) => key === 'sessionId' ? 's1' : key === 'storeId' ? 'http-localhost:8989' : key === 'projectId' ? 'project' : null });
    const route = { snapshot: { paramMap: params.value, queryParamMap: { getAll: () => [] } }, paramMap: params } as unknown as ActivatedRoute;
    TestBed.configureTestingModule({ providers: [
      { provide: ActivatedRoute, useValue: route }, { provide: SessionWorkspaceService, useValue: workspace },
      { provide: SessionChinookQueryService, useValue: query },
    ] });
    const component = TestBed.runInInjectionContext(() => new InvoiceExplorerComponent());
    (component as unknown as { queries: typeof query }).queries = query;
    TestBed.flushEffects();
    expect(query.execute).not.toHaveBeenCalled();

    params.next({ get: (key: string) => key === 'sessionId' ? 's2' : key === 'storeId' ? 'http-localhost:8989' : key === 'projectId' ? 'project' : null });
    TestBed.flushEffects();
    snapshots.set({ ...snapshots(), s2: { ...snapshot('s2'), contextSet: { ...snapshot('s2').contextSet, enabled: true } } });
    TestBed.flushEffects();
    expect(component.sessionId()).toBe('s2');
    expect(component.snapshot()?.session.id).toBe('s2');
    expect(component.scope()).toEqual(scope);
    expect(query.execute).not.toHaveBeenCalled();

    component.selectViewAll();
    TestBed.flushEffects();
    await component.load();
    expect(query.execute).toHaveBeenCalledTimes(1);
  });
});
