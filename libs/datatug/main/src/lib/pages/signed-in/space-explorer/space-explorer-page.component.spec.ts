import { CUSTOM_ELEMENTS_SCHEMA, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { SpaceExplorerPageComponent } from './space-explorer-page.component';
import {
  IExploreCollectionItem,
  IExploreDoc,
  SpaceExplorerService,
} from '../../../services/repo/space-explorer.service';

type Streams<T> = Map<string, Subject<T>>;

function streamFor<T>(streams: Streams<T>, segments: readonly string[]): Observable<T> {
  const key = segments.join('/');
  if (!streams.has(key)) streams.set(key, new Subject<T>());
  return streams.get(key) as Subject<T>;
}

async function setup(options: { throwOnCollection?: boolean; throwOnDocument?: boolean } = {}) {
  const docs: Streams<IExploreDoc> = new Map();
  const collections: Streams<IExploreCollectionItem[]> = new Map();
  const explorer = {
    watchDocument$: vi.fn((segments: readonly string[]) => {
      if (options.throwOnDocument) throw new Error('Invalid document reference');
      return streamFor(docs, segments);
    }),
    watchCollection$: vi.fn((segments: readonly string[]) => {
      if (options.throwOnCollection) throw new Error('Invalid collection reference');
      return streamFor(collections, segments);
    }),
  };
  const params = new BehaviorSubject<ParamMap>(convertToParamMap({ spaceId: 'family' }));
  TestBed.overrideComponent(SpaceExplorerPageComponent, {
    set: { providers: [{ provide: SpaceExplorerService, useValue: explorer }] },
  });
  TestBed.configureTestingModule({
    imports: [SpaceExplorerPageComponent],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: params } }],
  });
  const fixture = TestBed.createComponent(SpaceExplorerPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  // Ionic's scoped-slot patch hides light-DOM text from `textContent` in jsdom, so read the markup instead.
  const text = () => el.innerHTML.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  const button = (label: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('ion-button, ion-item[button]')).find((node) => node.innerHTML.includes(label)) as HTMLElement;
  const click = async (label: string) => {
    button(label).click();
    await fixture.whenStable();
  };
  const emitDoc = async (path: string, doc: IExploreDoc) => {
    docs.get(path)?.next(doc);
    await fixture.whenStable();
  };
  const emitCollection = async (path: string, items: IExploreCollectionItem[]) => {
    collections.get(path)?.next(items);
    await fixture.whenStable();
  };
  const customSegment = (fixture.componentInstance as unknown as { customSegment: WritableSignal<string> }).customSegment;
  return { fixture, el, text, button, click, emitDoc, emitCollection, explorer, docs, collections, params, customSegment };
}

describe('SpaceExplorerPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('roots the viewer at spaces/{spaceId} and shows a spinner until the document streams in', async () => {
    const { text, emitDoc, explorer } = await setup();
    expect(explorer.watchDocument$).toHaveBeenCalledWith(['spaces', 'family']);
    expect(text()).toContain('spaces/family');
    expect(text()).toContain('space: family');
    expect(text()).toContain('Loading document…');

    await emitDoc('spaces/family', { id: 'family', path: 'spaces/family', data: { title: 'Family' } });
    expect(text()).not.toContain('Loading document…');
    expect(text()).toContain('Document: spaces/family');
    expect(text()).toContain('"title": "Family"');
  });

  it('explains a missing document instead of rendering empty JSON', async () => {
    const { text, emitDoc } = await setup();
    await emitDoc('spaces/family', { id: 'family', path: 'spaces/family', data: undefined });
    expect(text()).toContain('No document found at spaces/family');
  });

  it('shows only the danger banner when the document stream errors', async () => {
    const { text, docs, fixture } = await setup();
    docs.get('spaces/family')?.error({ message: 'Missing or insufficient permissions.' });
    await fixture.whenStable();
    expect(text()).toContain('Missing or insufficient permissions.');
    expect(text()).not.toContain('Loading document…');
    expect(text()).not.toContain('No document found');
  });

  it('keeps the page alive when the SDK throws synchronously for a collection', async () => {
    const { text, click } = await setup({ throwOnCollection: true });
    await click('ext');
    expect(text()).toContain('Invalid collection reference');
    expect(text()).not.toContain('Loading collection…');
    await click('space: family');
    expect(text()).not.toContain('Invalid collection reference');
    expect(text()).toContain('Loading document…');
  });

  it('keeps the error when the SDK throws synchronously for a document', async () => {
    const { text } = await setup({ throwOnDocument: true });
    expect(text()).toContain('Invalid document reference');
    expect(text()).not.toContain('Loading document…');
  });

  it('shows loading, not the previous document, while the next one is on its way', async () => {
    const { text, click, emitCollection, emitDoc } = await setup();
    await emitDoc('spaces/family', { id: 'family', path: 'spaces/family', data: { root: true } });
    await click('ext');
    await emitCollection('spaces/family/ext', [{ id: 'contactus', path: 'spaces/family/ext/contactus', data: {} }]);
    await click('contactus');
    await emitDoc('spaces/family/ext/contactus', { id: 'contactus', path: 'spaces/family/ext/contactus', data: { a: 1 } });
    await click('space: family');
    expect(text()).toContain('Loading document…');
    expect(text()).not.toContain('Document: spaces/family/ext/contactus');
  });

  it('offers the known modules on the ext collection, even when it lists nothing', async () => {
    const { text, click, emitCollection, explorer } = await setup();
    await click('ext');
    await emitCollection('spaces/family/ext', []);
    expect(text()).toContain('Open a known module');
    await click('listus');
    expect(explorer.watchDocument$).toHaveBeenLastCalledWith(['spaces', 'family', 'ext', 'listus']);
  });

  it('stringifies a non-object error', async () => {
    const { text, docs, fixture } = await setup();
    docs.get('spaces/family')?.error('boom');
    await fixture.whenStable();
    expect(text()).toContain('boom');
  });

  it('drills from a suggested collection into a document and back via breadcrumbs', async () => {
    const { text, click, emitCollection, emitDoc, explorer } = await setup();
    await click('ext');
    expect(explorer.watchCollection$).toHaveBeenCalledWith(['spaces', 'family', 'ext']);
    expect(text()).toContain('Loading collection…');

    await emitCollection('spaces/family/ext', [
      { id: 'contactus', path: 'spaces/family/ext/contactus', data: { count: 2 } },
      { id: 'listus', path: 'spaces/family/ext/listus', data: {} },
    ]);
    expect(text()).toContain('2 document(s)');
    expect(text()).toContain('3 levels deep');
    expect(text()).toContain('"count": 2');

    await click('contactus');
    expect(explorer.watchDocument$).toHaveBeenLastCalledWith(['spaces', 'family', 'ext', 'contactus']);
    await emitDoc('spaces/family/ext/contactus', { id: 'contactus', path: 'spaces/family/ext/contactus', data: { a: 1 } });
    expect(text()).toContain('Document: spaces/family/ext/contactus');
    // Standing on an `ext/{module}` document suggests the module collections.
    for (const name of ['contacts', 'lists', 'events', 'assets', 'invites', 'items']) {
      expect(text()).toContain(name);
    }

    expect(text()).toContain('space: family / ext / contactus');

    await click('space: family');
    expect(explorer.watchDocument$).toHaveBeenLastCalledWith(['spaces', 'family']);
    await emitDoc('spaces/family', { id: 'family', path: 'spaces/family', data: { root: true } });
    expect(text()).toContain('Document: spaces/family');
    expect(text()).not.toContain('contactus');
  });

  it('shows the empty-collection state', async () => {
    const { text, click, emitCollection } = await setup();
    await click('ext');
    await emitCollection('spaces/family/ext', []);
    expect(text()).toContain('No documents found in this collection');
  });

  it('suggests no shortcuts below an unknown document', async () => {
    const { fixture, text, customSegment, click, emitCollection } = await setup();
    customSegment.set('custom');
    await click('Go');
    await emitCollection('spaces/family/custom', [{ id: 'd1', path: 'spaces/family/custom/d1', data: {} }]);
    await click('d1');
    await fixture.whenStable();
    expect(text()).toContain('Browse a subcollection');
    expect(text()).not.toContain('>ext<');
    expect(fixture.nativeElement.querySelectorAll('ion-button[fill="outline"]')).toHaveLength(0);
  });

  it.each([
    ['rejects a multi-segment name', 'ext/contactus', 'is not a valid collection name', false],
    ['ignores a blank name', '   ', '', false],
    ['opens a trimmed custom collection', ' notes ', '', true],
  ])('custom segment: %s', async (_label, value, error, navigates) => {
    const { text, click, customSegment, explorer } = await setup();
    customSegment.set(value);
    await click('Go');
    if (error) expect(text()).toContain(error);
    expect(explorer.watchCollection$).toHaveBeenCalledTimes(navigates ? 1 : 0);
    if (navigates) {
      expect(explorer.watchCollection$).toHaveBeenCalledWith(['spaces', 'family', 'notes']);
      expect(customSegment()).toBe('');
    } else {
      expect(customSegment()).toBe(value);
    }
  });

  it('re-roots at a new space when the route param changes', async () => {
    const { text, params, fixture, explorer } = await setup();
    params.next(convertToParamMap({ spaceId: 'work' }));
    await fixture.whenStable();
    expect(explorer.watchDocument$).toHaveBeenLastCalledWith(['spaces', 'work']);
    expect(text()).toContain('space: work');
  });
});
