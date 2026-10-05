import { afterEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { PublicDataService } from './public-data.service';
import { nativeFixture } from './native-fixture.spec-helper';
import { SavedPlanReview } from './saved-plan-review';
import { savedPlanIdentity } from './saved-plan-revalidation';
import type { QueriesService } from '../queries.service';

const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
async function savedFixture() {
  const fixture = await nativeFixture('ror');
  vi.stubGlobal('fetch', fixture.http);
  const metadata = new PublicDataService(),
    oldPins = await fixture.publish();
  const discovered = await metadata.discoverDeclared(
    fixture.context,
    signal(),
    oldPins,
  );
  const definition = metadata.scenario(
    fixture.contract.source as Parameters<PublicDataService['scenario']>[0],
    discovered,
    discovered.suggestions[0],
    { userRows: 1000, userOffset: 0 },
    discovered.declaredSources?.[0],
  );
  const pins = await fixture.publish('b'.repeat(40));
  const actual = metadata.revalidate.bind(metadata);
  vi.spyOn(metadata, 'revalidate').mockImplementation((query, abort) =>
    actual(query, abort, pins, fixture.context),
  );
  return { fixture, metadata, definition, pins };
}
describe('saved native plan bounded fresh metadata check and explicit separate copy', () => {
  it('retains original pins, runs no hidden lookup, binds acknowledgement to the exact check and saves through existing query storage', async () => {
    const { fixture, metadata, definition } = await savedFixture();
    const original = savedPlanIdentity(definition);
    fixture.http.mockClear();
    const createQuery = vi.fn((_project, query) => of(query));
    const state = new SavedPlanReview(
      () => definition,
      metadata,
      { createQuery } as unknown as QueriesService,
      () => ({ storeId: 'fixture', projectId: 'fixture' }),
    );
    expect(fixture.http).not.toHaveBeenCalled();
    expect(createQuery).not.toHaveBeenCalled();
    await state.check();
    expect(state.review()).toMatchObject({
      compatible: true,
      changes: [
        'canonical directory',
        'canonical models',
        'canonical meanings',
      ],
    });
    expect(state.review()?.copy?.publicData?.eligible).toBe(false);
    expect(state.review()?.suggestion?.sourceFacts?.release).toBe('v2.13');
    await state.saveCopy();
    expect(createQuery).not.toHaveBeenCalled();
    expect(state.message()).toMatch(/acknowledge/);
    state.acknowledge();
    await state.saveCopy();
    expect(createQuery).toHaveBeenCalledTimes(1);
    const copy = createQuery.mock.calls[0][1];
    expect(copy.id).not.toBe(definition.id);
    expect(copy.publicData.canonical.directory.revision).toBe('b'.repeat(40));
    expect(savedPlanIdentity(definition)).toBe(original);
    expect(state.message()).toMatch(/Original pins and results are retained/);
    await state.check();
    expect(state.acknowledged()).toBeUndefined();
    expect(
      fixture.http.mock.calls.every(([url]) =>
        String(url).startsWith('https://raw.githubusercontent.com/'),
      ),
    ).toBe(true);
    state.destroy();
  });
  it('rejects changed exact target registration and does not reinterpret stored eligibility as authority', async () => {
    const { fixture, metadata, definition } = await savedFixture();
    const target = fixture.models.models.find(
      (record) => record['repository'] === fixture.provider['repository'],
    );
    Object.assign(target?.['files'] ?? {}, { json: 'model/other.json' });
    const pins = await fixture.publish('c'.repeat(40));
    const checked = await PublicDataService.prototype.revalidate.call(
      metadata,
      {
        ...definition,
        publicData: {
          ...definition.publicData,
          eligible: true,
        } as typeof definition.publicData,
      },
      signal(),
      pins,
      fixture.context,
    );
    expect(checked.compatible).toBe(false);
    expect(checked.copy).toBeUndefined();
    expect(checked.reason).toMatch(/No unique structurally compatible/);
  });
  it('makes missing exact runtime mapping explicit while retaining positive structural compatibility', async () => {
    const { fixture, metadata, definition } = await savedFixture();
    fixture.provider['recordsets'] = [{ name: fixture.contract.target.entity }];
    const pins = await fixture.publish('d'.repeat(40));
    const checked = await PublicDataService.prototype.revalidate.call(
      metadata,
      definition,
      signal(),
      pins,
      fixture.context,
    );
    expect(checked.compatible).toBe(true);
    expect(checked.copy).toBeUndefined();
    expect(checked.reason).toMatch(/runtime|recordset|model entity/);
  });
  it('cannot save an acknowledged check after the current query changes without a fresh check', async () => {
    const { metadata, definition } = await savedFixture();
    let current = definition;
    const createQuery = vi.fn((_project, query) => of(query));
    const state = new SavedPlanReview(
      () => current,
      metadata,
      { createQuery } as unknown as QueriesService,
      () => ({ storeId: 'fixture', projectId: 'fixture' }),
    );
    await state.check();
    state.acknowledge();
    current = {
      ...definition,
      request: {
        ...definition.request,
        text: 'changed query',
      } as typeof definition.request,
    };
    await state.saveCopy();
    expect(createQuery).not.toHaveBeenCalled();
    state.destroy();
  });
});
