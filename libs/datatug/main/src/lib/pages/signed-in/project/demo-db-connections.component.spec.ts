import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { DemoDbConnectionsComponent } from './demo-db-connections.component';

const canonical = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
const datasets = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'];
const entries = datasets.flatMap((dataset) => [
  { id: `${dataset}-sqlite`, dataset, storage: 'sqlite', tags: [dataset, 'sqlite'], environments: ['dev'],
    readiness: 'public-api', source: `https://ovdb.demodb.dev/v1/databases/${dataset}`, query: 'ovdb-read' },
  { id: `${dataset}-postgresql`, dataset, storage: 'postgresql', tags: [dataset, 'postgresql'], environments: ['QA', 'UAT'],
    readiness: 'hosted-api-pending', source: `https://demodb.dev/${dataset}/`, query: 'setup-required' },
  { id: `${dataset}-ingitdb`, dataset, storage: 'ingitdb', tags: [dataset, 'ingitdb'], environments: ['dev'],
    readiness: 'hosted-repository', source: `https://github.com/demo-db/${dataset}/tree/${'a'.repeat(40)}/ingitdb`, query: 'local-checkout-required' },
]);
const bigQueryEditions = datasets.map((dataset, index) => ({
  id: `${dataset}-bigquery`, dataset, storage: 'bigquery', sourceProjectId: 'demodb-dev', datasetId: dataset,
  location: 'US', authentication: 'google-account-required', executionProjectId: 'user-selected',
  publicReadRole: 'READER', publicReadPrincipal: 'allAuthenticatedUsers',
  readiness: 'public-read-user-project-required', query: 'not-enabled-in-browser', copy: 'not-enabled',
  tableCount: [11, 13, 11, 16, 71, 6][index], rowCount: [15607, 3310, 255, 47268, 759240, 13584][index],
  sourceRepository: `https://github.com/demo-db/${dataset}`, sourceRevision: 'c'.repeat(40),
  sourceSqliteSha256: 'd'.repeat(64),
  verification: 'https://github.com/demo-db/websites/blob/main/config/bigquery-hosting.json',
}));
const plans = ['world-bank-wdi', 'new-york-citibike'].map((id) => ({ id, title: id,
  directory: `https://github.com/openvaultdb/directory/blob/${'b'.repeat(40)}/index.json`, readiness: 'setup-required' }));

describe('shared project database connections', () => {
  it('groups 18 existing editions and six BigQuery editions under six logical datasets', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
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
      expect(catalog.connections.find((entry) => entry.id === `${dataset}-${storage}`)?.tags).toEqual([dataset, storage]);
    }
    expect(fixture.nativeElement.querySelectorAll('ion-list ion-item').length).toBe(8);
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="dataset-"]').length).toBe(6);
    expect(fixture.componentInstance['readiness'](catalog.connections[1])).toBe('PostgreSQL query endpoint pending');
    expect(fixture.nativeElement.querySelectorAll('ion-button').length).toBe(0);
    expect(fixture.nativeElement.querySelector('a[href*="chinook-postgresql-artist-tracks"]')).toBeNull();
    expect(fixture.nativeElement.innerHTML).toContain('Demo databases');
    for (const dataset of datasets) {
      expect(fixture.nativeElement.querySelector(`a[data-testid="explore-local-${dataset}"]`)?.getAttribute('href'))
        .toBe(`/demo/sqlite/${dataset}`);
    }
    const rendered = fixture.nativeElement.innerHTML;
    expect(rendered).toContain('your own execution project required');
    expect(rendered).toContain('Browser querying and copying are unavailable');
    expect(rendered).toContain('demodb-dev.chinook');
    expect(rendered).toContain('Source SQLite SHA-256');
    expect(fixture.nativeElement.querySelectorAll('a[href="https://console.cloud.google.com/bigquery"]').length).toBe(6);
    expect(fixture.nativeElement.querySelectorAll('.tab-panel-header h2')[1].innerHTML).toContain('discoveries');
    for (const dataset of datasets) {
      const row = fixture.nativeElement.querySelector(`[data-testid="dataset-${dataset}"]`);
      expect(row.innerHTML).toContain('SQLite');
      expect(row.innerHTML).toContain('PostgreSQL');
      expect(row.innerHTML).toContain('inGitDB');
      expect(row.innerHTML).toContain('BigQuery');
    }
  });

  it('still accepts a published catalogue whose SQLite sources name the legacy OVDB base', async () => {
    const legacy = entries.map((entry) => entry.storage === 'sqlite'
      ? { ...entry, source: `https://demodb.dev/ovdb/v1/databases/${entry.dataset}` }
      : entry);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: legacy,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['catalog']()).toBeTruthy();
  });

  it('deep-links only the ready Chinook PostgreSQL edition to its saved cross-storage query', async () => {
    const active = entries.map((entry) => entry.id === 'chinook-postgresql'
      ? { ...entry, readiness: 'public-api', query: 'ovdb-read',
          source: 'https://cloud.openvaultdb.com/v1/databases/chinook-postgresql' }
      : entry);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: active,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['catalog']()).toBeDefined();
    const anchors = fixture.nativeElement.querySelectorAll('a[href*="chinook-postgresql-artist-tracks"]');
    expect(anchors.length).toBe(1);
    expect(anchors[0].textContent).toContain('PostgreSQL artist track totals');
    const target = new URL(anchors[0].getAttribute('href'), 'https://datatug.app');
    expect(target.pathname).toContain('/query/demodb%2Fchinook-postgresql-artist-tracks');
    expect(target.searchParams.get('id')).toBe('demodb/chinook-postgresql-artist-tracks');
    const connection = fixture.componentInstance['catalog']()?.connections.find((entry) => entry.id === 'chinook-postgresql');
    if (!connection) throw new Error('Ready Chinook PostgreSQL connection did not load.');
    expect(fixture.componentInstance['readiness'](connection)).toBe('Public read-only PostgreSQL through OVDB');
  });

  it('accepts six exact public PostgreSQL endpoints while exposing only the Chinook query', async () => {
    const active = entries.map((entry) => entry.storage === 'postgresql'
      ? { ...entry, readiness: 'public-api', query: 'ovdb-read',
          source: `https://cloud.openvaultdb.com/v1/databases/${entry.dataset}-postgresql` }
      : entry);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: active,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['catalog']()).toBeDefined();
    expect(fixture.nativeElement.querySelectorAll('a[href*="chinook-postgresql-artist-tracks"]').length).toBe(1);
    // Each public edition opens in DataTug through OVDB; a pending one has no such link.
    for (const dataset of datasets) {
      const link = fixture.nativeElement.querySelector(`[data-testid="explore-postgresql-${dataset}"]`);
      expect(link.getAttribute('href')).toBe(`/demo/ovdb/${dataset}-postgresql`);
      expect(link.textContent).toContain('read-only via OpenVaultDB');
    }
  });

  it('offers no DataTug link for a PostgreSQL edition that is still pending', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid^="explore-postgresql-"]')).toBeNull();
  });

  it('rejects an active PostgreSQL declaration with a different endpoint', async () => {
    const changed = entries.map((entry) => entry.id === 'northwind-postgresql'
      ? { ...entry, readiness: 'public-api', query: 'ovdb-read',
          source: 'https://cloud.openvaultdb.com/v1/databases/chinook-postgresql' }
      : entry);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: changed,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['catalog']()).toBeUndefined();
    expect(fixture.componentInstance['error']()).toMatch(/could not be loaded/);
  });

  it('continues to render a cached v1 catalogue created before hosted editions were added', async () => {
    const legacyCatalog = { format: 'datatug-demo-connections/v1', connections: entries, bigQueryPlans: plans };
    const getRawJson = vi.fn(() => of(legacyCatalog));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['catalog']()).toBeDefined();
    expect(fixture.nativeElement.querySelectorAll('ion-list ion-item').length).toBe(8);
    expect(fixture.nativeElement.innerHTML).not.toContain('Hosted BigQuery editions');
    expect(fixture.nativeElement.innerHTML).toContain('BigQuery discoveries (setup planned)');
  });

  it('never loads the old or a lookalike repository as the shared project', async () => {
    const getRawJson = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    for (const projectId of ['chinook-demo@datatug@', 'datatug-demo-projects@datatug@demo-project-1',
      'datatug-demo-project@datatug@other', 'datatug-demo-project@datatug@demo-project-1@untrusted']) {
      fixture.componentRef.setInput('projectRef', { storeId: 'github.com', projectId });
      fixture.detectChanges();
    }
    expect(getRawJson).not.toHaveBeenCalled();
  });

  it('rejects a catalogue link outside the pinned public origins', async () => {
    const changed = entries.map((entry) => entry.id === 'chinook-ingitdb'
      ? { ...entry, source: 'https://example.test/chinook' } : entry);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: changed,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['catalog']()).toBeUndefined();
    expect(fixture.componentInstance['error']()).toMatch(/could not be loaded/);
  });

  it('rejects hosted editions that change the pinned source or execution project contract', async () => {
    const changed = bigQueryEditions.map((edition) => edition.dataset === 'chinook'
      ? { ...edition, sourceProjectId: 'untrusted-project' } : edition);
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryEditions: changed, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [provideRouter([]), { provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['catalog']()).toBeUndefined();
    expect(fixture.componentInstance['error']()).toMatch(/could not be loaded/);
  });
});
