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

describe('shared project database connections', () => {
  it('reads the nested canonical project catalogue and renders all 18 tagged editions', async () => {
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: entries,
      bigQueryPlans: [{ id: 'bigquery-world-bank-wdi', title: 'World Bank WDI',
        directory: `https://github.com/openvaultdb/directory/blob/${'b'.repeat(40)}/index.json`, readiness: 'setup-required' }] }));
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
    expect(fixture.nativeElement.querySelectorAll('ion-item').length).toBe(19);
    expect(fixture.componentInstance['readiness'](catalog.connections[1])).toBe('PostgreSQL query endpoint pending');
    expect(fixture.nativeElement.querySelectorAll('ion-button').length).toBe(0);
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
    const getRawJson = vi.fn(() => of({ format: 'datatug-demo-connections/v1', connections: changed, bigQueryPlans: [] }));
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
