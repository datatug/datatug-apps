import { CUSTOM_ELEMENTS_SCHEMA, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VaultExplorerPageComponent } from './vault-explorer-page.component';
import {
  IVaultCollectionEntry,
  IVaultCollectionSchemaInfo,
  IVaultRecordRow,
  VaultExplorerService,
} from '../../../services/repo/vault-explorer.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rootSchema: IVaultCollectionSchemaInfo = {
  schema: { columns_order: ['title', 'title'] } as IVaultCollectionSchemaInfo['schema'],
  collectionPath: 'data/spaces',
};
const family: IVaultRecordRow = { _id: 'family', _path: 'data/spaces/$records/family.yaml', _sha: 'abc', title: 'Family', meta: { kids: 2 }, note: null };
const work: IVaultRecordRow = { _id: 'work', title: 'Work', owner: 'alice' };

async function setup() {
  const pending = {
    collections: [] as ReturnType<typeof deferred<IVaultCollectionEntry[]>>[],
    schema: [] as ReturnType<typeof deferred<IVaultCollectionSchemaInfo>>[],
    records: [] as ReturnType<typeof deferred<IVaultRecordRow[]>>[],
    subs: [] as ReturnType<typeof deferred<string[]>>[],
  };
  const push = <T,>(list: ReturnType<typeof deferred<T>>[]) => {
    const next = deferred<T>();
    list.push(next);
    return next.promise;
  };
  const explorer = {
    connect: vi.fn(),
    loadCollections: vi.fn(() => push(pending.collections)),
    loadRootCollectionSchema: vi.fn(() => push(pending.schema)),
    loadRecords: vi.fn(() => push(pending.records)),
    listSubcollections: vi.fn(() => push(pending.subs)),
  };
  TestBed.overrideComponent(VaultExplorerPageComponent, {
    set: { providers: [{ provide: VaultExplorerService, useValue: explorer }] },
  });
  TestBed.configureTestingModule({
    imports: [VaultExplorerPageComponent],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [provideRouter([])],
  });
  const fixture = TestBed.createComponent(VaultExplorerPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const component = fixture.componentInstance as unknown as Record<'repoInput' | 'branchInput' | 'tokenInput', WritableSignal<string>>;
  // Ionic's scoped-slot patch hides light-DOM text from `textContent` in jsdom, so read the markup instead.
  const text = () => el.innerHTML.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  // Let the component's `await` continuation run (it schedules change detection), then wait for that render.
  const stable = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const click = async (label: string, selector = 'ion-button, ion-item[button]') => {
    const target = Array.from(el.querySelectorAll<HTMLElement>(selector)).find((node) => node.innerHTML.replace(/\s+/g, ' ').includes(label));
    if (!target) throw new Error(`No clickable "${label}"`);
    target.click();
    await stable();
  };
  const settle = async <T,>(promise: { resolve: (value: T) => void }, value: T) => {
    promise.resolve(value);
    await stable();
  };
  const fail = async (promise: { reject: (error: unknown) => void }, error: unknown) => {
    promise.reject(error);
    await stable();
  };
  /** Connects to owner/vault and lists the given root collections. */
  const connect = async (collections: IVaultCollectionEntry[] = [{ id: 'spaces', path: 'spaces' }, { id: 'users' }] as IVaultCollectionEntry[]) => {
    component.repoInput.set(' owner/vault ');
    await click('Connect');
    await settle(pending.collections[pending.collections.length - 1], collections);
  };
  /** Opens the `spaces` root collection and resolves its records. */
  const openSpaces = async (records: IVaultRecordRow[] = [family, work]) => {
    await click('spaces', 'ion-item[button]');
    await settle(pending.schema[pending.schema.length - 1], rootSchema);
    await settle(pending.records[pending.records.length - 1], records);
  };
  const rows = () => Array.from(el.querySelectorAll<HTMLElement>('tr.row'));
  const headers = () => Array.from(el.querySelectorAll('th')).map((th) => th.textContent?.trim());
  return { fixture, el, component, text, click, settle, fail, connect, openSpaces, rows, headers, explorer, pending, stable };
}

describe('VaultExplorerPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('prompts for a repository before connecting', async () => {
    const { text, explorer } = await setup();
    expect(text()).toContain('Enter a repository laid out as an inGitDB vault');
    expect(text()).toContain('Connect');
    expect(explorer.connect).not.toHaveBeenCalled();
  });

  it('rejects a repository that is not owner/repo', async () => {
    const { component, click, text, explorer } = await setup();
    component.repoInput.set('vault');
    await click('Connect');
    expect(text()).toContain('Repository must be in "owner/repo" format');
    expect(explorer.connect).not.toHaveBeenCalled();
  });

  it('connects with trimmed inputs, shows a spinner, then lists collections', async () => {
    const { component, click, text, explorer, pending, settle } = await setup();
    component.repoInput.set(' owner/vault ');
    component.branchInput.set('  ');
    component.tokenInput.set(' secret ');
    await click('Connect');
    expect(explorer.connect).toHaveBeenCalledWith('secret');
    expect(explorer.loadCollections).toHaveBeenCalledWith('owner/vault', 'main');
    expect(text()).toContain('Loading vault config…');
    expect(text()).toContain('Reconnect');

    await settle(pending.collections[0], [{ id: 'spaces' }, { id: 'users' }] as IVaultCollectionEntry[]);
    expect(text()).not.toContain('Loading vault config…');
    expect(text()).toContain('Collections spaces users');
    expect(text()).toContain('Select a collection above.');
  });

  it('passes no token when the token field is blank', async () => {
    const { connect, explorer } = await setup();
    await connect();
    expect(explorer.connect).toHaveBeenCalledWith(undefined);
  });

  it('explains an empty vault config', async () => {
    const { connect, text } = await setup();
    await connect([]);
    expect(text()).toContain('No collections found. Is there a .ingitdb/root-collections.yaml at the repo root?');
  });

  it.each([
    ['an HTTP error', { response: { status: 404 }, message: 'Not Found' }, 'Failed to load vault config: 404 Not Found'],
    ['a plain error', new Error('offline'), 'Failed to load vault config: offline'],
  ])('shows only the danger banner on %s', async (_label, error, message) => {
    const { component, click, fail, pending, text } = await setup();
    component.repoInput.set('owner/vault');
    await click('Connect');
    await fail(pending.collections[0], error);
    expect(text()).toContain(message);
    expect(text()).not.toContain('Loading vault config…');
    expect(text()).not.toContain('(none)');
  });

  it.each([true, false])('ignores a superseded connect response (stale request fails: %s)', async (staleFails) => {
    const { component, click, settle, fail, pending, text } = await setup();
    component.repoInput.set('owner/old');
    await click('Connect');
    component.repoInput.set('owner/new');
    await click('Reconnect');
    await settle(pending.collections[1], [{ id: 'fresh' }] as IVaultCollectionEntry[]);
    if (staleFails) await fail(pending.collections[0], new Error('late failure'));
    else await settle(pending.collections[0], [{ id: 'stale' }] as IVaultCollectionEntry[]);
    expect(text()).toContain('fresh');
    expect(text()).not.toContain('stale');
    expect(text()).not.toContain('late failure');
  });

  it('loads a root collection through its schema and renders a records table', async () => {
    const { connect, click, settle, pending, explorer, text, headers, rows, el } = await setup();
    await connect();
    await click('spaces', 'ion-item[button]');
    expect(explorer.loadRootCollectionSchema).toHaveBeenCalledWith('owner/vault', 'main', 'spaces');
    expect(text()).toContain('Loading records…');
    expect(text()).toContain('active');

    await settle(pending.schema[0], rootSchema);
    expect(explorer.loadRecords).toHaveBeenCalledWith('owner/vault', 'main', 'spaces', rootSchema.schema, 'data/spaces');
    await settle(pending.records[0], [family, work]);
    expect(text()).toContain('2 record(s)');
    expect(headers()).toEqual(['id (record key)', 'title', 'meta', 'note', 'owner']);
    expect(rows().map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim()))).toEqual([
      ['family', 'Family', '{"kids":2}', '', ''],
      ['work', 'Work', '', '', 'alice'],
    ]);
    expect(el.querySelector('td[title="{&quot;kids&quot;:2}"], td[title=\'{"kids":2}\']')).not.toBeNull();
  });

  it('shows the empty-records state', async () => {
    const { connect, openSpaces, text } = await setup();
    await connect();
    await openSpaces([]);
    expect(text()).toContain('No records in this collection.');
  });

  it('shows a records error with a working Retry', async () => {
    const { connect, click, settle, fail, pending, text, explorer } = await setup();
    await connect();
    await click('spaces', 'ion-item[button]');
    await fail(pending.schema[0], { response: { status: 403 } });
    expect(text()).toContain('Failed to load records: 403');
    expect(text()).not.toContain('No records in this collection.');

    await click('Retry');
    expect(explorer.loadRootCollectionSchema).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('Failed to load records');
    await settle(pending.schema[1], rootSchema);
    await settle(pending.records[0], [work]);
    expect(text()).toContain('1 record(s)');
  });

  it.each(['click', 'enter', 'space'])('opens a record via %s and probes its subcollections', async (how) => {
    const { connect, openSpaces, rows, stable, text, explorer, settle, pending, el } = await setup();
    await connect();
    await openSpaces();
    const row = rows()[0];
    if (how === 'click') row.click();
    else row.dispatchEvent(new KeyboardEvent('keydown', { key: how === 'enter' ? 'Enter' : ' ' }));
    await stable();
    expect(explorer.listSubcollections).toHaveBeenCalledWith('owner/vault', 'data/spaces/family', 'main');
    expect(text()).toContain('Record: family');
    expect(text()).toContain('Probing for nested subcollections…');
    const json = JSON.parse(el.querySelector('pre.raw-json')?.textContent ?? '{}');
    expect(json).toEqual({ title: 'Family', meta: { kids: 2 }, note: null });
    expect(text()).toContain('file: data/spaces/$records/family.yaml');

    await settle(pending.subs[0], []);
    expect(text()).toContain('(no nested subcollections)');
  });

  it('notes a failed subcollection probe without hiding the record', async () => {
    const { connect, openSpaces, rows, stable, fail, pending, text } = await setup();
    await connect();
    await openSpaces();
    rows()[1].click();
    await stable();
    expect(text()).not.toContain('file:');
    await fail(pending.subs[0], new Error('rate limited'));
    expect(text()).toContain('Record: work');
    expect(text()).toContain('(could not probe subcollections: rate limited)');
    expect(text()).toContain('(no nested subcollections)');
  });

  it('drills into a nested subcollection and navigates back with breadcrumbs', async () => {
    const { connect, openSpaces, rows, stable, settle, pending, explorer, click, text } = await setup();
    await connect();
    await openSpaces();
    rows()[0].click();
    await stable();
    await settle(pending.subs[0], ['contacts']);

    await click('▸ contacts');
    expect(explorer.loadRootCollectionSchema).toHaveBeenCalledTimes(1);
    expect(explorer.loadRecords).toHaveBeenLastCalledWith('owner/vault', 'main', 'data/spaces/family/contacts', {}, 'data/spaces/family/contacts');
    await settle(pending.records[1], [{ _id: 'c1', name: 'Bob' }]);
    expect(text()).toContain('collections / spaces / family / contacts');
    expect(text()).toContain('Bob');
    expect(text()).toContain('spaces active');

    // Back to the record: re-probes its subcollections.
    await click('family');
    expect(explorer.listSubcollections).toHaveBeenCalledTimes(2);
    await settle(pending.subs[1], ['contacts']);
    expect(text()).toContain('Record: family');

    // Back to the root collection: reloads its records through the schema.
    await click('spaces', 'ion-button[size="small"]');
    expect(explorer.loadRootCollectionSchema).toHaveBeenCalledTimes(2);

    await click('collections', 'ion-button[size="small"]');
    expect(text()).toContain('Select a collection above.');
  });

  it.each([true, false])('ignores a records response superseded by navigation (stale request fails: %s)', async (staleFails) => {
    const { connect, click, settle, fail, pending, text } = await setup();
    await connect();
    await click('spaces', 'ion-item[button]');
    await click('users', 'ion-item[button]');
    await settle(pending.schema[1], { schema: {} as IVaultCollectionSchemaInfo['schema'], collectionPath: 'users' });
    await settle(pending.records[0], [{ _id: 'u1' }]);
    if (staleFails) await fail(pending.schema[0], new Error('late failure'));
    else {
      await settle(pending.schema[0], rootSchema);
      await settle(pending.records[1], [family]);
    }
    expect(text()).toContain('u1');
    expect(text()).not.toContain('Family');
    expect(text()).not.toContain('late failure');
  });

  it('ignores a subcollection probe superseded by navigation', async () => {
    const { connect, openSpaces, rows, stable, click, settle, fail, pending, text } = await setup();
    await connect();
    await openSpaces();
    rows()[0].click();
    await stable();
    await click('spaces', 'ion-button[size="small"]');
    await fail(pending.subs[0], new Error('late probe'));
    expect(text()).not.toContain('late probe');
    await settle(pending.schema[1], rootSchema);
    await settle(pending.records[1], [work]);
    rows()[0].click();
    await stable();
    await click('spaces', 'ion-button[size="small"]');
    await settle(pending.subs[1], ['ghost']);
    expect(text()).not.toContain('ghost');
  });
});
