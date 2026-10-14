import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { demoSqliteCatalog } from '../../../../queries/demo-sqlite-catalog';
import { localOvdbFetchFor } from '../../../../demo-sqlite/local-demodb.spec-helper';
import { fetchOvdbDescriptor, NO_SINGLE_COLUMN_KEY, type OvdbConnection, type OvdbDescriptor } from '../../../../ovdb/ovdb-connection';
import { OvdbConfirmService } from '../../../../ovdb/ovdb-confirm.service';
import { OvdbRecordEditorComponent, type OvdbRecordChange } from './ovdb-record-editor.component';

const entry = demoSqliteCatalog.chinook;

function fieldNamed<T extends { name: string }>(fields: readonly T[], name: string): T {
  const found = fields.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
}

async function setup(options: { collection: string; record: Record<string, unknown>; confirm?: boolean; descriptor?: OvdbDescriptor }) {
  const local = localOvdbFetchFor(entry);
  const descriptor = options.descriptor ?? (await fetchOvdbDescriptor(local.fetch, local.baseUrl, 'chinook'));
  const connection: OvdbConnection = { id: 'c', title: 'Chinook', baseUrl: local.baseUrl, databaseId: 'chinook', fetch: local.fetch, descriptor };
  const confirm = vi.fn(async () => options.confirm ?? true);
  await TestBed.configureTestingModule({
    imports: [OvdbRecordEditorComponent],
    providers: [{ provide: OvdbConfirmService, useValue: { confirm } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(OvdbRecordEditorComponent);
  fixture.componentRef.setInput('connection', connection);
  fixture.componentRef.setInput('collection', options.collection);
  fixture.componentRef.setInput('record', options.record);
  const changes: OvdbRecordChange[] = [];
  fixture.componentInstance.changed.subscribe((change) => changes.push(change));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, el, q, local, confirm, changes, settle, component: fixture.componentInstance };
}

describe('OvdbRecordEditorComponent', () => {
  it('offers Edit and Delete for a writable table with a single-column key', async () => {
    const { q } = await setup({ collection: 'Artist', record: { ArtistId: 1, Name: 'AC/DC' } });
    expect(q('record-edit')).not.toBeNull();
    expect(q('record-delete')).not.toBeNull();
    expect(q('record-actions-reason')).toBeNull();
  });

  it('edits type-aware fields: key and blob locked, decimals as text, then saves only changes', async () => {
    const { q, el, component, local, changes, settle } = await setup({
      collection: 'Track',
      record: { TrackId: 1, Name: 'For Those About To Rock', UnitPrice: 0.99, Cover: { $type: 'blob', base64: 'AA==' } },
    });
    expect(q('record-field-UnitPrice')?.textContent).toContain('0.99');
    expect(q('record-field-Cover')?.textContent).toContain('(binary, 1 bytes)');
    q('record-edit')?.click();
    await settle();
    expect(q('record-input-TrackId')).toBeNull();
    expect(q('record-input-Cover')).toBeNull();
    expect(el.textContent).toContain('Primary key fields cannot be edited.');
    expect(el.textContent).toContain('Binary values cannot be edited here.');
    expect((q('record-input-UnitPrice') as unknown as { inputmode?: string }).inputmode).toBe('decimal');
    const fields = component['fields']();
    component.setText(fieldNamed(fields, 'UnitPrice'), '1.49');
    q('record-save')?.click();
    await vi.waitFor(() => expect(changes).toEqual(['saved']));
    expect(local.requests.at(-1)?.body).toEqual({
      ops: [{ op: 'update', key: 'Track/1', updates: [{ fieldName: 'UnitPrice', value: '1.49' }] }],
    });
    await settle();
    expect(q('record-notice')?.textContent).toContain('Saved.');
    expect(q('record-save')).toBeNull();
  });

  it('validates before sending anything', async () => {
    const { q, component, local, settle } = await setup({ collection: 'Album', record: { AlbumId: 1, Title: 'X', ArtistId: 1 } });
    component.startEdit();
    const fields = component['fields']();
    component.setText(fieldNamed(fields, 'ArtistId'), 'abc');
    const before = local.requests.length;
    await component.save();
    await settle();
    expect(local.requests.length).toBe(before);
    expect(q('record-field-ArtistId')?.textContent).toContain('ArtistId must be a whole number.');
    // Title is NOT NULL: it offers no NULL checkbox.
    expect(q('record-null-Title')).toBeNull();
  });

  it('deletes after confirmation and reports it', async () => {
    const { q, confirm, changes, local } = await setup({ collection: 'Artist', record: { ArtistId: 3, Name: 'Aerosmith' } });
    q('record-delete')?.click();
    await vi.waitFor(() => expect(changes).toEqual(['deleted']));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Delete record?', confirmText: 'Delete' }));
    expect(local.database.tables['Artist'].map((row) => row['ArtistId'])).toEqual([1, 2]);
  });

  it('does nothing when the deletion is cancelled', async () => {
    const { component, confirm, changes, local } = await setup({ collection: 'Artist', record: { ArtistId: 3, Name: 'Aerosmith' }, confirm: false });
    const before = local.requests.length;
    await component.deleteRecord();
    expect(confirm).toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(local.requests.length).toBe(before);
  });

  it('shows a readable foreign key error when deleting an Artist that has Albums', async () => {
    const { component, q, changes, settle } = await setup({ collection: 'Artist', record: { ArtistId: 1, Name: 'AC/DC' } });
    await component.deleteRecord();
    await settle();
    expect(changes).toEqual([]);
    expect(q('record-error')?.textContent).toContain('other records refer to it');
  });

  it('hides Edit and Delete for a composite-key table and says why', async () => {
    const { q } = await setup({ collection: 'PlaylistTrack', record: { PlaylistId: 1, TrackId: 1 } });
    expect(q('record-edit')).toBeNull();
    expect(q('record-delete')).toBeNull();
    expect(q('record-actions-reason')?.getAttribute('title')).toBe(NO_SINGLE_COLUMN_KEY);
  });

  it('renders a hosted read-only (Neon-like) record with no mutation controls at all', async () => {
    const neon: OvdbDescriptor = {
      id: 'chinook-postgresql',
      engine: 'postgres',
      capabilities: { read: false, query: true, dtql: true, write: false, delete: false, reset: false, persistent: true },
      collections: ['artist'],
      schemas: { collections: { artist: { fields: { artist_id: { type: 'integer' }, name: { type: 'string' } }, primaryKey: ['artist_id'] } } },
    };
    const { q, el } = await setup({ collection: 'artist', record: { artist_id: 1, name: 'AC/DC' }, descriptor: neon });
    expect(q('record-edit')).toBeNull();
    expect(q('record-delete')).toBeNull();
    expect(q('record-actions-reason')).toBeNull();
    expect(el.textContent).toContain('AC/DC');
  });
});
