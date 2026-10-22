import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { OvdbRecordEditorComponent } from '../pages/signed-in/env-db-table/ovdb-record-editor/ovdb-record-editor.component';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { demoLogEvidenceMapping } from '../pages/demo-logs/demo-log-source-adapter';
import { describe, expect, it, vi } from 'vitest';
import { demoSqliteCatalog } from '../queries/demo-sqlite-catalog';
import { localOvdbFetchFor, MemorySqliteDatabase } from '../demo-sqlite/local-demodb.spec-helper';
import { fetchOvdbDescriptor, type OvdbConnection } from './ovdb-connection';
import { OvdbConfirmService, type OvdbConfirmRequest } from './ovdb-confirm.service';
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
  const confirm = vi.fn<(request: OvdbConfirmRequest) => Promise<boolean>>(async () => options.confirm ?? true);
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
  it.each([
    ['Orders', 'OrderID', 11045, 'order'],
    ['Samples', 'SampleKey', 'sample A&B/7', 'sample'],
  ] as const)('carries the exact selected %s record through its source-owned query key', async (collection, field, value, queryParam) => {
    const database = new MemorySqliteDatabase({ tables: { [collection]: {
      columns: [{ name: field, declaredType: typeof value === 'number' ? 'INTEGER' : 'TEXT', notNull: true, primaryKeyPosition: 1 }],
      primaryKey: [field], foreignKeys: [],
    } } }, () => ({ [collection]: [{ [field]: value }] }));
    const { fixture, q, settle } = await setup(collection, { database });
    fixture.componentRef.setInput('relatedEvidence', collection === 'Orders'
      ? demoLogEvidenceMapping('northwind')
      : { collection, field, path: '/demo/logs', queryParam });
    await vi.waitFor(async () => { await settle(); expect(q('row-0')).not.toBeNull(); });
    q('row-0')?.click(); await settle();
    const link = fixture.debugElement.queryAll(By.directive(RouterLink)).find(item => item.nativeElement.textContent.trim() === 'Related log evidence');
    expect(link).toBeDefined();
    const directive = link?.injector.get(RouterLink);
    if (!directive?.urlTree) throw new Error('Missing rendered related evidence target');
    const url = new URL(TestBed.inject(Router).serializeUrl(directive.urlTree), 'https://example.test');
    expect(url.pathname).toBe('/demo/logs');
    expect([...url.searchParams.keys()]).toEqual([queryParam]);
    expect(url.searchParams.get(queryParam)).toBe(String(value));
    fixture.componentRef.setInput('relatedEvidence', { collection, field, path: '/demo/logs' });
    await settle();
    expect(fixture.debugElement.queryAll(By.directive(RouterLink)).some(item => item.nativeElement.textContent.trim() === 'Related log evidence')).toBe(false);
  });

  it('creates a typed record, selects it, keeps duplicate errors in the form, and resets', async () => {
    const { fixture, q, settle, local, component } = await setup('Artist');
    await vi.waitFor(async () => { await settle(); expect(q('row-0')).not.toBeNull(); });
    q('record-create')?.click();
    await settle();
    const editor = fixture.debugElement.query(By.directive(OvdbRecordEditorComponent)).componentInstance as OvdbRecordEditorComponent;
    const fields = editor['fields']();
    const key = fields.find((field) => field.name === 'ArtistId');
    const name = fields.find((field) => field.name === 'Name');
    if (!key || !name) throw new Error('Missing Artist fields');
    expect(q('record-input-ArtistId')?.getAttribute('aria-label')).toBe('ArtistId');
    const nameInput = q('record-input-Name') as HTMLElement & { disabled: boolean };
    expect(nameInput.disabled).toBe(true);
    q('record-null-Name')?.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: false } }));
    await settle();
    expect(nameInput.disabled).toBe(false);
    editor.setText(key, 'bad');
    await editor.save();
    await settle();
    expect(q('record-field-ArtistId')?.textContent).toContain('whole number');
    editor.setText(key, '1');
    editor.setText(name, 'Duplicate');
    await editor.save();
    await settle();
    expect(q('record-error')?.textContent).toContain('already exists');
    expect(q('record-save')).not.toBeNull();
    editor.setText(key, '4');
    editor.setNull(name, true);
    await editor.save();
    await vi.waitFor(async () => { await settle(); expect(q('ovdb-record')?.textContent).toContain('ArtistId 4'); });
    await vi.waitFor(async () => { await settle(); expect(q('ovdb-rows')?.querySelectorAll('tbody tr')).toHaveLength(4); });
    expect(q('record-field-Name')?.textContent).toContain('NULL');
    expect(local.modified.value).toBe(true);
    await component.resetDatabase();
    await settle();
    expect(local.database.tables['Artist']).toHaveLength(3);
    expect(q('ovdb-record')).toBeNull();
  });

  it('hides Create for a composite key and read-only capability', async () => {
    const { q } = await setup('PlaylistTrack');
    expect(q('record-create')).toBeNull();
    TestBed.resetTestingModule();
    const readonly = await setup('Artist', { database: new MemorySqliteDatabase(undefined, undefined, { read: true, query: true, write: false, delete: false, reset: false, persistent: true }) });
    expect(readonly.q('record-create')).toBeNull();
  });

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

  it('applies a linked record focus once and preserves a later selection on reload', async () => {
    const { fixture, q, settle, component } = await setup('Artist');
    fixture.componentRef.setInput('focusRecordId', '1');
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-record')?.textContent).toContain('ArtistId 1');
    });
    q('row-2')?.click();
    await settle();
    expect(q('row-2')?.getAttribute('aria-current')).toBe('true');
    await component.reload();
    await settle();
    expect(q('row-2')?.getAttribute('aria-current')).toBe('true');
  });

  it('refreshes a saved deep-linked record outside the first grid page', async () => {
    const database = new MemorySqliteDatabase();
    for (let id = 4; id <= 104; id++) database.tables['Artist'].push({ ArtistId: id, Name: `Artist ${id}` });
    database.tables['Artist'].push({ ArtistId: 11039, Name: 'Before save' });
    const { fixture, q, settle } = await setup('Artist', { database });
    fixture.componentRef.setInput('focusRecordId', '11039');
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-rows')?.querySelectorAll('tbody tr')).toHaveLength(100);
      expect(q('record-field-Name')?.textContent).toContain('Before save');
    });
    q('record-edit')?.click();
    await settle();
    const editor = fixture.debugElement.query(By.directive(OvdbRecordEditorComponent)).componentInstance as OvdbRecordEditorComponent;
    const name = editor['fields']().find((field) => field.name === 'Name');
    if (!name) throw new Error('Missing Artist Name field');
    editor.setText(name, 'After save');
    await editor.save();
    await vi.waitFor(async () => {
      await settle();
      expect(q('record-field-Name')?.textContent).toContain('After save');
    });
    expect(database.tables['Artist'].at(-1)?.['Name']).toBe('After save');
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

  it('opens a row with the keyboard: Enter and Space, rows reachable by Tab', async () => {
    const { q, settle } = await setup('Artist');
    await vi.waitFor(async () => {
      await settle();
      expect(q('row-0')).not.toBeNull();
    });
    expect(q('row-0')?.getAttribute('tabindex')).toBe('0');
    const press = (el: HTMLElement | null, key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      el?.dispatchEvent(event);
      return event;
    };
    expect(press(q('row-1'), 'Enter').defaultPrevented).toBe(true);
    await settle();
    expect(q('row-1')?.getAttribute('aria-current')).toBe('true');
    expect(q('ovdb-record')?.textContent).toContain('Artist');
    expect(press(q('row-2'), ' ').defaultPrevented).toBe(true); // Space must not scroll the page
    await settle();
    expect(q('row-2')?.getAttribute('aria-current')).toBe('true');
    expect(q('row-1')?.getAttribute('aria-current')).toBeNull();
    // Other keys do nothing.
    press(q('row-0'), 'a');
    await settle();
    expect(q('row-0')?.getAttribute('aria-current')).toBeNull();
  });

  it('shows NULL and an empty string in the grid differently from each other and from text', async () => {
    const database = new MemorySqliteDatabase();
    database.tables['Artist'][0]['Name'] = null;
    database.tables['Artist'][1]['Name'] = '';
    database.tables['Artist'][2]['Name'] = 'NULL';
    const { q, settle } = await setup('Artist', { database });
    await vi.waitFor(async () => {
      await settle();
      expect(q('row-2')).not.toBeNull();
    });
    const nameCell = (i: number) => q(`row-${i}`)?.querySelectorAll('td')[1] as HTMLElement;
    expect([0, 1, 2].map((i) => [nameCell(i).textContent, nameCell(i).dataset['cellKind']])).toEqual([
      ['NULL', 'null'],
      ['(empty)', 'empty'],
      ['NULL', 'value'],
    ]);
    expect(nameCell(0).classList.contains('ovdb-null')).toBe(true);
    expect(nameCell(2).classList.contains('ovdb-null')).toBe(false);
  });

  it('opens one Reset confirmation however many times the button is clicked, and adds the host note', async () => {
    const { component, confirm, fixture } = await setup(undefined, { confirm: false });
    fixture.componentRef.setInput('resetNote', 'Resetting needs a network connection.');
    await Promise.all([component.resetDatabase(), component.resetDatabase()]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].message).toContain('Resetting needs a network connection.');
    expect(confirm.mock.calls[0][0].message).toContain('All your local changes');
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
