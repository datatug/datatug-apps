import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { SneatUserService } from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ProjectBrowserDbComponent } from './project-browser-db.component';
import { OvdbDatabaseBrowserComponent } from '../../ovdb/ovdb-database-browser.component';
import { DemoProjectContinuationService } from '../../project/new-project/demo-project-continuation.service';
import { demoSqliteCatalog } from '../../queries/demo-sqlite-catalog';
import { LocalDemoDbService } from '../../demo-sqlite/local-demodb.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { QueryRuntimeRegistry } from '../../queries/query-runtime-registry.service';
import { DemoTableDraftService } from '../../queries/demo-table-draft.service';

@Component({ selector: 'sneat-datatug-ovdb-database-browser', template: '<p>Edited rows</p>' })
class BrowserStub {
  readonly connection = input<unknown>(); readonly basePath = input<unknown>(); readonly table = input<unknown>();
  readonly navigationQuery = input<unknown>(); readonly statusText = input<string>();
}
const ref = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud' as const, branch: 'main' };
const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'demo', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
const sha = demoSqliteCatalog.chinook.sha256;
async function setup(options: { missing?: boolean; sha?: string; actor?: string } = {}) {
  const continuations = new DemoProjectContinuationService();
  const token = continuations.create({ dataset: 'chinook', canonicalSha256: sha, table: 'Artist', source });
  continuations.bind(token, 'actor', source, 'operation', ref);
  const connection = { id: 'live', title: 'Edited Chinook', databaseId: 'chinook', baseUrl: 'https://browser.local/v1', fetch: vi.fn(), descriptor: { id: 'chinook', canonical: { sha256: sha, bytes: 10, url: 'https://demo/file' }, capabilities: { tugql: true }, collections: ['Artist'] } };
  const state = signal({ kind: 'ready' });
  const peek = vi.fn(() => options.missing ? undefined : { entry: demoSqliteCatalog.chinook, state, connection: signal(connection) });
  const declaration = { id: 'chinook-sqlite', dataset: 'chinook', fixtureSha256: options.sha ?? sha, storage: 'sqlite', environments: ['dev'] };
  const catalog = vi.fn(() => of({ connections: [declaration] }));
  const params = new BehaviorSubject(convertToParamMap({ connectionId: 'chinook-sqlite', table: 'Artist' }));
  const query = new BehaviorSubject(convertToParamMap({ projectApi: 'cloud', branch: 'main', demoContinuation: token }));
  await TestBed.configureTestingModule({ imports: [ProjectBrowserDbComponent], providers: [provideRouter([]),
    { provide: ActivatedRoute, useValue: { paramMap: params, queryParamMap: query, snapshot: { paramMap: params.value, queryParamMap: query.value } } },
    { provide: SneatUserService, useValue: { userState: of({ status: 'authenticated', user: { uid: options.actor ?? 'actor' } }) } },
    { provide: DatatugNavContextService, useValue: { currentProject: of({ ref }) } },
    { provide: LocalDemoDbService, useValue: { peek } },
    { provide: DemoProjectContinuationService, useValue: continuations },
    { provide: ProjectQueryApiService, useValue: { connectionCatalog: catalog } },
  ] }).overrideComponent(ProjectBrowserDbComponent, { remove: { imports: [OvdbDatabaseBrowserComponent] }, add: { imports: [BrowserStub] } }).compileComponents();
  const registration = TestBed.inject(QueryRuntimeRegistry).register(connection as never);
  const router = TestBed.inject(Router); const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ProjectBrowserDbComponent);
  fixture.detectChanges();
  for (let i = 0; i < 3; i++) await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, peek, state, catalog, navigate, router, registration, declaration };
}
describe('copied project browser database', () => {
  it('uses the active edited session and sends a bounded TugQL draft to existing Query in the declared environment', async () => {
    const h = await setup();
    expect(h.fixture.nativeElement.textContent).toContain('Project files in GitHub; database and edits in this browser');
    expect(h.component.connection()?.title).toBe('Edited Chinook');
    expect(h.peek).toHaveBeenCalledWith('chinook');
    h.component.queryTable();
    const tree = h.navigate.mock.calls[0][0];
    if (typeof tree === 'string') throw Error('Expected URL tree');
    expect(tree.queryParams['env']).toBe('dev');
    expect(tree.queryParams['runtime']).toBe(h.registration.selectionId);
    const draft = await TestBed.inject(DemoTableDraftService).read(tree.queryParams['demoDraft'], ref, h.registration.selectionId, 'dev', 'actor');
    expect(draft).toMatchObject({ connectionId: 'chinook-sqlite', request: { queryType: 'TugQL', text: 'from:\n  name: "Artist"\nlimit: 100\n' } });
    expect(JSON.stringify(draft)).not.toContain('runtime-');
    const drafts = TestBed.inject(DemoTableDraftService);
    await expect(drafts.read(tree.queryParams['demoDraft'], ref, h.registration.selectionId, 'dev', 'actor')).resolves.toEqual(draft);
    drafts.consume(tree.queryParams['demoDraft']);
    await expect(drafts.read(tree.queryParams['demoDraft'], ref, h.registration.selectionId, 'dev', 'actor')).rejects.toThrow('unavailable');
    h.state.set({ kind: 'closed' }); await h.fixture.whenStable();
    expect(h.component.connection()).toBeUndefined();
  });
  it.each([{ missing: true }, { sha: '0'.repeat(64) }, { actor: 'different' }])('shows explicit recovery without starting/importing a runtime: %j', async (options) => {
    const h = await setup(options);
    expect(h.component.connection()).toBeUndefined();
    expect(h.fixture.nativeElement.querySelector('[data-testid=project-browser-recovery]')).not.toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
