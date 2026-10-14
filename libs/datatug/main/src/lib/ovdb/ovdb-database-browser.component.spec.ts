import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import { localOvdbFetchFor, MemorySqliteDatabase } from '../demo-sqlite/local-demodb.spec-helper';
import { fetchOvdbDescriptor, type OvdbConnection } from './ovdb-connection';
import { OvdbConfirmService } from './ovdb-confirm.service';
import { OvdbDatabaseBrowserComponent } from './ovdb-database-browser.component';

const entry = demoSqliteCatalog.chinook;

async function setup(table?: string, options: {
  confirm?: boolean;
  database?: MemorySqliteDatabase;
  wrapFetch?: (local: ReturnType<typeof localOvdbFetchFor>) => typeof globalThis.fetch;
} = {}) {
  const local = localOvdbFetchFor(entry, options.database);
  const fetchFn = options.wrapFetch?.(local) ?? local.fetch;
  const descriptor = await fetchOvdbDescriptor(fetchFn, local.baseUrl, 'chinook');
  const connection: OvdbConnection = { id: 'c', title: 'Chinook (local SQLite)', baseUrl: local.baseUrl, databaseId: 'chinook', fetch: fetchFn, descriptor };
  const confirm = vi.fn(async () => options.confirm ?? true);
  await TestBed.configureTestingModule({
    imports: [OvdbDatabaseBrowserComponent],
    providers: [provideRouter([]), { provide: OvdbConfirmService, useValue: { confirm } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(OvdbDatabaseBrowserComponent);
  fixture.componentRef.setInput('connection', connection);
  fixture.componentRef.setInput('basePath', ['/demo', 'sqlite', 'chinook']);
  fixture.componentRef.setInput('table', table);
  fixture.componentRef.setInput('statusText', 'Local copy ready');
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  return { fixture, el, q, local, confirm, settle, component: fixture.componentInstance };
}

describe('OvdbDatabaseBrowserComponent', () => {
  it('lands in the table list with links to each table', async () => {
    const { q, el } = await setup();
    expect(q('ovdb-table-list')).not.toBeNull();
    expect(q('table-Album')?.getAttribute('href')).toBe('/demo/sqlite/chinook/table/Album');
    expect(q('ovdb-database-header')?.textContent).toContain('4 tables');
    expect(q('ovdb-database-header')?.textContent).toContain('editable');
    expect(q('ovdb-status')?.textContent).toBe('Local copy ready');
    expect(el.querySelectorAll('[data-testid^="table-"]').length).toBe(4);
  });

  it('shows a table and opens a record with mutation controls', async () => {
    const { q, settle } = await setup('Artist');
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-rows')?.querySelectorAll('tbody tr').length).toBe(3);
    });
    q('row-2')?.click();
    await settle();
    expect(q('ovdb-record')?.textContent).toContain('Aerosmith');
    expect(q('record-edit')).not.toBeNull();
  });

  it('refreshes the table after a delete and clears the selection', async () => {
    const { q, settle, local } = await setup('Artist');
    await vi.waitFor(async () => {
      await settle();
      expect(q('row-2')).not.toBeNull();
    });
    q('row-2')?.click();
    await settle();
    q('record-delete')?.click();
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-rows')?.querySelectorAll('tbody tr').length).toBe(2);
    });
    expect(q('ovdb-record')).toBeNull();
    expect(local.database.tables['Artist']).toHaveLength(2);
  });

  it('explains an unknown table', async () => {
    const { q } = await setup('Nope');
    expect(q('ovdb-unknown-table')?.textContent).toContain('There is no table “Nope”');
  });

  it('resets after confirmation, verifies the canonical copy and reloads', async () => {
    const { q, component, local, confirm, settle } = await setup('Artist');
    local.database.tables['Artist'][0]['Name'] = 'Changed';
    local.modified.set(true);
    await component.resetDatabase();
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      header: 'Reset Database?',
      message: expect.stringContaining('All your local changes'),
    }));
    expect(local.database.resets).toBe(1);
    expect(local.requests.some((r) => r.method === 'POST' && r.url.endsWith('/v1/databases/chinook/reset'))).toBe(true);
    expect(q('reset-message')?.textContent).toContain(`SHA-256 ${entry.sha256.slice(0, 12)}`);
    expect(q('ovdb-rows')?.textContent).toContain('AC/DC');
  });

  it('does not reset when cancelled', async () => {
    const { component, local } = await setup(undefined, { confirm: false });
    await component.resetDatabase();
    expect(local.database.resets).toBe(0);
  });

  it('reports a reset that still leaves local changes', async () => {
    // A server whose reset leaves the copy marked as modified.
    const { component, q, settle } = await setup(undefined, {
      wrapFetch: (local) => async (input, init) => {
        const response = await local.fetch(input, init);
        if (String(input).endsWith('/reset')) local.modified.set(true);
        return response;
      },
    });
    await component.resetDatabase();
    await settle();
    expect(q('reset-error')?.textContent).toContain('still reports local changes');
    expect(q('reset-message')).toBeNull();
  });

  it('shows no Reset Database for a database whose descriptor does not allow it', async () => {
    const readOnly = new MemorySqliteDatabase(undefined, undefined, {
      read: false, query: true, write: false, delete: false, reset: false, persistent: true,
    });
    const { q } = await setup(undefined, { database: readOnly });
    expect(q('reset-database')).toBeNull();
    expect(q('ovdb-database-header')?.textContent).toContain('read-only');
    expect(q('ovdb-table-list')).not.toBeNull();
  });
});
