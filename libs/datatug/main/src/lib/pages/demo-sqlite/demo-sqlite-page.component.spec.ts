import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type Params } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OvdbConfirmService } from '../../ovdb/ovdb-confirm.service';
import { LOCAL_DEMODB_ENVIRONMENT, LOCAL_DEMODB_RUNTIME_LOADER, type LocalDemoDbEnvironment } from '../../demo-sqlite/local-demodb.service';
import { FakeLocalDemoDbRuntime, fakeEnvironment, namedError } from '../../demo-sqlite/local-demodb.spec-helper';
import type { LocalDemoDbRuntimeOptions } from '../../demo-sqlite/local-demodb.types';
import { DemoSqlitePageComponent } from './demo-sqlite-page.component';

async function setup(params: Params, environment: LocalDemoDbEnvironment = fakeEnvironment()) {
  const runtimes: FakeLocalDemoDbRuntime[] = [];
  const loader = vi.fn(async () => (options: LocalDemoDbRuntimeOptions) => {
    const runtime = new FakeLocalDemoDbRuntime(options);
    runtimes.push(runtime);
    return runtime;
  });
  const paramMap = new BehaviorSubject(convertToParamMap(params));
  await TestBed.configureTestingModule({
    imports: [DemoSqlitePageComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap, snapshot: { paramMap: paramMap.value } } },
      { provide: LOCAL_DEMODB_RUNTIME_LOADER, useValue: loader },
      { provide: LOCAL_DEMODB_ENVIRONMENT, useValue: environment },
      { provide: OvdbConfirmService, useValue: { confirm: vi.fn(async () => true) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(DemoSqlitePageComponent);
  const el = fixture.nativeElement as HTMLElement;
  const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { fixture, el, q, runtimes, loader, settle, paramMap };
}

describe('DemoSqlitePageComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('lists the datasets for /demo/sqlite', async () => {
    const { q, el, loader } = await setup({});
    expect(q('demo-sqlite-datasets')?.textContent).toContain('Explore a DemoDB dataset');
    expect(q('dataset-sakila')?.getAttribute('href')).toBe('/demo/sqlite/sakila');
    expect(el.querySelectorAll('[data-testid^="dataset-"]').length).toBe(6);
    expect(loader).not.toHaveBeenCalled();
  });

  it('explains an unknown dataset and links to the known ones', async () => {
    const { q, loader } = await setup({ dataset: 'nope' });
    expect(q('demo-sqlite-datasets')?.textContent).toContain('There is no DemoDB dataset “nope”');
    expect(q('dataset-chinook')).not.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('opens a dataset case-insensitively and lands in its table list', async () => {
    const { q, runtimes, settle } = await setup({ dataset: 'Chinook' });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].open({ imported: true });
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table-list')).not.toBeNull();
    });
    expect(q('table-Artist')?.getAttribute('href')).toBe('/demo/sqlite/chinook/table/Artist');
    expect(q('ovdb-status')?.textContent).toBe('Local copy ready');
    expect(q('reset-database')).not.toBeNull();
    expect(q('demo-sqlite-not-persistent')).toBeNull();
    expect(q('demo-sqlite-replaced')).toBeNull();
  });

  it('opens straight into a table when the address names one', async () => {
    const { q, runtimes, settle } = await setup({ dataset: 'chinook', table: 'Album' });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].open();
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-rows')?.textContent).toContain('Balls to the Wall');
    });
  });

  it('warns when edits will not persist and when the demo DB was updated', async () => {
    const { q, runtimes, settle } = await setup({ dataset: 'pubs' });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].open({ persistent: false, replacedPreviousVersion: true, fallback: { reason: 'security', message: 'private' } });
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-sqlite-not-persistent')?.textContent).toContain('Changes will not be saved in this browser');
    });
    expect(q('demo-sqlite-replaced')?.textContent).toContain('Demo DB updated; your local edits were reset.');
    expect(q('ovdb-status')?.textContent).toBe('Local copy (memory only)');
  });

  it('asks before a large download: Continue shows phased progress, then the tables', async () => {
    const { q, runtimes, settle, loader } = await setup({ dataset: 'adventureworks' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-sqlite-confirm-large')).not.toBeNull();
    });
    expect(q('demo-sqlite-confirm-large')?.textContent).toContain(
      'This dataset downloads ~35.4 MB and uses ~253.6 MB of browser storage (working copy + pristine copy). Continue?',
    );
    expect(q('demo-sqlite-cancel')?.getAttribute('href')).toBe('/demo/sqlite');
    expect(loader).not.toHaveBeenCalled();
    vi.useFakeTimers();
    q('demo-sqlite-continue')?.click();
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].progress({ phase: 'download', loaded: 12_400_000 });
    await settle();
    expect(q('demo-sqlite-progress')).toBeNull(); // not before ~400 ms
    vi.advanceTimersByTime(400);
    await settle();
    expect(q('demo-sqlite-progress')?.textContent).toContain('Preparing local copy (126.8 MB)');
    expect(q('demo-sqlite-progress')?.textContent).toContain('Downloading 12.4 of 126.8 MB');
    runtimes[0].progress({ phase: 'install' });
    await settle();
    expect(q('demo-sqlite-progress')?.textContent).toContain('Verifying and saving the local copy');
    vi.useRealTimers();
    runtimes[0].open({ imported: true });
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table-list')).not.toBeNull();
    });
  });

  it('refuses a dataset the storage quota cannot hold and offers the others', async () => {
    const env = fakeEnvironment({ storageEstimate: async () => ({ quota: 100_000_000, usage: 0 }) });
    const { q, loader, settle } = await setup({ dataset: 'adventureworks' }, env);
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-sqlite-no-storage')).not.toBeNull();
    });
    expect(q('demo-sqlite-no-storage')?.textContent).toContain('Not enough browser storage for this dataset');
    expect(q('dataset-chinook')).not.toBeNull();
    expect(q('dataset-adventureworks')).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('needs a regular browser window for a large dataset without OPFS', async () => {
    const { q, loader, settle } = await setup({ dataset: 'adventureworks' }, fakeEnvironment({ opfsAvailable: async () => false }));
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-sqlite-unsupported')).not.toBeNull();
    });
    expect(q('demo-sqlite-unsupported')?.textContent).toContain('needs a regular desktop browser window with local storage');
    expect(loader).not.toHaveBeenCalled();
  });

  it('offers a retry for a locked local copy', async () => {
    const { q, runtimes, settle } = await setup({ dataset: 'chinook' });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].fail(namedError('PoolUnavailableError', 'locked', { reason: 'locked', retriable: true }));
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-sqlite-locked')).not.toBeNull();
    });
    q('demo-sqlite-retry')?.click();
    await vi.waitFor(() => expect(runtimes).toHaveLength(2));
    runtimes[1].open();
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table-list')).not.toBeNull();
    });
  });

  it('switches datasets by closing the previous local copy', async () => {
    const { runtimes, paramMap, settle } = await setup({ dataset: 'chinook' });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    runtimes[0].open();
    paramMap.next(convertToParamMap({ dataset: 'pubs' }));
    await settle();
    await vi.waitFor(() => expect(runtimes).toHaveLength(2));
    expect(runtimes[0].closed).toBe(true);
  });
});
