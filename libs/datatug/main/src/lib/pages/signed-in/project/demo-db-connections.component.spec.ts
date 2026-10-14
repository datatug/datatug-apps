import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { DEMODB_LOCAL_COPY, DemoDbConnectionsComponent } from './demo-db-connections.component';

const canonical = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
const datasets = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'];
const entries = datasets.flatMap((dataset) => [
  { id: `${dataset}-sqlite`, dataset, storage: 'sqlite', tags: [dataset, 'sqlite'], environments: ['dev'],
    readiness: 'public-api', source: `https://demodb.dev/ovdb/v1/databases/${dataset}`,
    fixtureSha256: 'a'.repeat(64), query: 'ovdb-read', copy: 'explicit-browser-import' },
  { id: `${dataset}-postgresql`, dataset, storage: 'postgresql', tags: [dataset, 'postgresql'], environments: ['QA', 'UAT'],
    readiness: 'hosted-api-pending', source: `https://demodb.dev/${dataset}/`, query: 'setup-required', copy: 'unavailable' },
  { id: `${dataset}-ingitdb`, dataset, storage: 'ingitdb', tags: [dataset, 'ingitdb'], environments: ['dev'],
    readiness: 'hosted-repository', source: `https://github.com/demo-db/${dataset}`, query: 'local-checkout-required', copy: 'unavailable' },
]);

describe('shared project database connections', () => {
  it('reads the nested canonical project catalogue and renders all 18 tagged editions', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryPlans: [{ id: 'bigquery-world-bank-wdi', title: 'World Bank WDI',
        directory: 'https://github.com/openvaultdb/directory/blob/main/index.json', readiness: 'setup-required' }] }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [
        { provide: GithubProjectReaderService, useValue: { getRawJson } },
        { provide: DEMODB_LOCAL_COPY, useValue: { connection: vi.fn(async () => undefined) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getRawJson).toHaveBeenCalledWith(canonical.projectId, 'connections/demo-db.json');
    const catalog = fixture.componentInstance['catalog']();
    if (!catalog) throw new Error('DemoDB connection catalogue did not load.');
    for (const dataset of datasets) for (const storage of ['sqlite', 'postgresql', 'ingitdb']) {
      expect(catalog?.connections.find((entry) => entry.id === `${dataset}-${storage}`)?.tags).toEqual([dataset, storage]);
    }
    expect(fixture.componentInstance['readiness'](catalog.connections[1])).toBe('PostgreSQL query endpoint pending');
    expect(catalog?.bigQueryPlans[0].title).toBe('World Bank WDI');
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(19);
    expect(fixture.nativeElement.querySelectorAll('ion-button').length).toBe(6);
  });

  it('does not read an old or lookalike repository as the trusted shared project', async () => {
    const getRawJson = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [
        { provide: GithubProjectReaderService, useValue: { getRawJson } },
        { provide: DEMODB_LOCAL_COPY, useValue: { connection: vi.fn(async () => undefined) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    for (const projectId of ['chinook-demo@datatug@', 'datatug-demo-projects@datatug@demo-project-1',
      'datatug-demo-project@datatug@other', 'datatug-demo-project@datatug@demo-project-1@untrusted']) {
      fixture.componentRef.setInput('projectRef', { storeId: 'github.com', projectId });
      fixture.detectChanges();
    }
    expect(getRawJson).not.toHaveBeenCalled();
  });

  it('registers a completed IndexedDB generation as a separate local Dev connection and query route', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries, bigQueryPlans: [] }));
    const local = { id: 'chinook-indexeddb-local', dataset: 'chinook', storage: 'indexeddb', environment: 'Dev',
      tags: ['chinook', 'indexeddb', 'local'], sourceConnectionId: 'chinook-sqlite',
      rowCount: 15607, databaseName: 'datatug-demo-dev-chinook-123', retiredDatabaseNames: [] };
    await TestBed.configureTestingModule({ imports: [DemoDbConnectionsComponent], providers: [
      { provide: GithubProjectReaderService, useValue: { getRawJson } },
      { provide: DEMODB_LOCAL_COPY, useValue: { connection: vi.fn(async (dataset: string) => dataset === 'chinook' ? local : undefined) } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance['localConnections']()).toHaveLength(1));
    fixture.detectChanges();
    const href = '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/local-dev/chinook';
    expect(fixture.componentInstance['localQueryHref']('chinook')).toBe(href);
    expect(Array.from(fixture.nativeElement.querySelectorAll('a')).map((link) => (link as HTMLAnchorElement).getAttribute('href'))).toContain(href);
    expect(fixture.nativeElement.textContent).toContain('chinook / IndexedDB / Dev');
    expect(fixture.nativeElement.textContent).toContain('chinook · indexeddb · local');
  });
});
