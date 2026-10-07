import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GithubProjectReaderService } from '../../../services/repo/github/github-project-reader.service';
import { DemoDbConnectionsComponent } from './demo-db-connections.component';

const canonical = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
const datasets = ['chinook', 'northwind', 'pubs', 'sakila', 'adventureworks', 'employees'];
const entries = datasets.flatMap((dataset) => [
  { id: `${dataset}-sqlite`, dataset, storage: 'sqlite', tags: [dataset, 'sqlite'], environments: ['dev'],
    readiness: 'public-api', source: `https://demodb.dev/ovdb/v1/databases/${dataset}`, query: 'ovdb-read' },
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
  it('renders 18 existing editions, six hosted BigQuery datasets and blocked discoveries', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryEditions, bigQueryPlans: plans }));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [{ provide: GithubProjectReaderService, useValue: { getRawJson } }],
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
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(26);
    expect(fixture.componentInstance['readiness'](catalog.connections[1])).toBe('PostgreSQL query endpoint pending');
    expect(fixture.nativeElement.querySelectorAll('ion-button').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Hosted BigQuery editions');
    const rendered = fixture.nativeElement.innerHTML;
    expect(rendered).toContain('demodb-dev.chinook');
    expect(rendered).toContain('your own BigQuery execution project');
    expect(rendered).toContain('Browser queries and copy are not enabled');
    expect(fixture.nativeElement.querySelectorAll('a[href="https://console.cloud.google.com/bigquery"]').length).toBe(6);
    expect(fixture.nativeElement.querySelectorAll('ion-card-title')[2].textContent).toContain('discoveries');
  });

  it('continues to render a cached v1 catalogue created before hosted editions were added', async () => {
    const legacyCatalog = { format: 'datatug-demo-connections/v1', connections: entries, bigQueryPlans: plans };
    const getRawJson = vi.fn(() => of(legacyCatalog));
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [{ provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['catalog']()).toBeDefined();
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(20);
    expect(fixture.nativeElement.innerHTML).not.toContain('Hosted BigQuery editions');
    expect(fixture.nativeElement.innerHTML).toContain('BigQuery discoveries (setup planned)');
  });

  it('never loads the old or a lookalike repository as the shared project', async () => {
    const getRawJson = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DemoDbConnectionsComponent],
      providers: [{ provide: GithubProjectReaderService, useValue: { getRawJson } }],
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
      providers: [{ provide: GithubProjectReaderService, useValue: { getRawJson } }],
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
      providers: [{ provide: GithubProjectReaderService, useValue: { getRawJson } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbConnectionsComponent);
    fixture.componentRef.setInput('projectRef', canonical);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['catalog']()).toBeUndefined();
    expect(fixture.componentInstance['error']()).toMatch(/could not be loaded/);
  });
});
