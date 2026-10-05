import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { nativeFixture } from './native-fixture.spec-helper';
import { immutableUrl } from './canonical-metadata';
import { PublicDataService } from './public-data.service';
import { ConfiguredPublicDataSourcesService } from './configured-public-data-sources.service';
import { ProjectService } from '../../services/project/project.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import type { IProjectContext } from '../../nav/nav-models';
import { parseHttpsJsonCatalog } from '../../project-files/https-json-catalog';

const abort = () => new AbortController().signal;
afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});
async function configured() {
  const fixture = await nativeFixture('ror', true);
  vi.stubGlobal('fetch', fixture.http);
  const pins = await fixture.publish(),
    metadata = new PublicDataService();
  const discover = metadata.discoverDeclared.bind(metadata);
  vi.spyOn(metadata, 'discoverDeclared').mockImplementation((context, signal) =>
    discover(context, signal, pins),
  );
  const raw = fixture.files.get(immutableUrl(fixture.context.configuration));
  const github = {
    getRawJson: vi.fn(() => of(fixture.context.catalog)),
    getRawText: vi.fn(() => of(raw)),
    readInfo: vi.fn(() =>
      of({
        commit: fixture.context.configuration.revision,
        mayBeStale: false,
        fromMirror: false,
      }),
    ),
    forget: vi.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      ConfiguredPublicDataSourcesService,
      { provide: PublicDataService, useValue: metadata },
      { provide: GithubProjectReaderService, useValue: github },
      { provide: ProjectService, useValue: {} },
      {
        provide: EnvironmentService,
        useValue: {
          listEnvironments: () => of([{ id: 'local' }]),
          getEnvSummary: () =>
            of({
              title: 'Local',
              dbServers: [
                {
                  id: 'user',
                  driver: 'https-json',
                  catalogs: ['affiliations'],
                },
              ],
            }),
          getCatalogTables: () =>
            of({
              tables: [
                { schema: '', name: 'affiliations', dbType: 'BASE TABLE' },
              ],
              views: [],
            }),
        },
      },
    ],
  });
  const project = {
    ref: { storeId: 'github.com', projectId: 'user-project@example@' },
    summary: { environments: [{ id: 'local' }] },
  } as IProjectContext;
  return {
    fixture,
    pins,
    metadata,
    github,
    project,
    service: TestBed.inject(ConfiguredPublicDataSourcesService),
  };
}
describe('configured private-schema-shaped public fixture declaration without global registration', () => {
  it('resolves source selection to immutable scope and compatible suggestion without hashes typed by the user or row reads', async () => {
    const state = await configured();
    const connections = await state.service.list(state.project, abort());
    expect(connections).toHaveLength(1);
    const inspected = await state.service.inspect(
      state.project,
      connections[0],
      abort(),
    );
    expect(inspected.fields).toHaveLength(1);
    expect(inspected.fields[0]).toMatchObject({
      property: 'ror_id',
      source: state.fixture.contract.source,
      context: { data: state.fixture.data },
    });
    expect(inspected.discovery.suggestions[0]).toMatchObject({
      compatibility: 'compatible',
      eligible: false,
    });
    expect(
      state.fixture.models.models.some(
        (model) =>
          model['repository'] ===
          state.fixture.contract.source.schema.repository,
      ),
    ).toBe(false);
    expect(
      state.fixture.http.mock.calls.some(
        ([url]) => String(url) === immutableUrl(state.fixture.data),
      ),
    ).toBe(false);
    const refreshed = await state.service.resolveSaved(
      state.project,
      inspected.fields[0].context ??
        (() => {
          throw new Error('Missing verified field context.');
        })(),
      abort(),
    );
    expect(state.github.forget).toHaveBeenCalledWith('example', 'user-project');
    expect(refreshed).toEqual(connections[0].declaration);
  });
  it('refuses mismatched model namespace/property/revision and duplicate physical declarations rather than guessing', async () => {
    const state = await configured();
    const original = state.fixture.context.catalog;
    for (const mutate of [
      (raw: typeof original) =>
        Object.assign(raw.sourceModel?.tables[0].fields[1] ?? {}, {
          property: 'other',
        }),
      (raw: typeof original) =>
        Object.assign(raw.sourceModel?.schema ?? {}, {
          revision: 'd'.repeat(40),
        }),
    ]) {
      const raw = structuredClone(original);
      mutate(raw);
      const text = JSON.stringify(raw),
        configuration = await state.fixture.put(
          state.fixture.context.configuration,
          text,
        );
      const parsed = parseHttpsJsonCatalog(text, { trust: 'untrusted' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      await expect(
        state.metadata.discoverDeclared(
          { ...state.fixture.context, configuration, catalog: parsed.value },
          abort(),
          state.pins,
        ),
      ).rejects.toThrow();
    }
    const duplicate = structuredClone(original);
    if (duplicate.sourceModel)
      Object.assign(duplicate.sourceModel, {
        tables: [
          ...duplicate.sourceModel.tables,
          duplicate.sourceModel.tables[0],
        ],
      });
    expect(
      parseHttpsJsonCatalog(JSON.stringify(duplicate), { trust: 'untrusted' })
        .ok,
    ).toBe(false);
  });
  it('detects current configured data pins separately from compatibility and requires explicit acknowledgement before changed-plan save', async () => {
    const state = await configured();
    const discovery = await state.metadata.discoverDeclared(
      state.fixture.context,
      abort(),
      state.pins,
    );
    const plan = state.metadata.scenario(
      state.fixture.contract.source,
      discovery,
      discovery.suggestions[0],
      { userRows: 1000, userOffset: 0 },
      discovery.declaredSources?.[0],
    );
    const raw = structuredClone(state.fixture.context.catalog);
    const changed = await state.fixture.put(state.fixture.data, '[]');
    Object.assign(raw.sha256, { affiliations: changed.sha256 });
    const text = JSON.stringify(raw),
      config = await state.fixture.put(
        state.fixture.context.configuration,
        text,
      );
    const parsed = parseHttpsJsonCatalog(text, { trust: 'untrusted' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const checked = await state.metadata.revalidate(plan, abort(), state.pins, {
      ...state.fixture.context,
      configuration: config,
      catalog: parsed.value,
    });
    expect(checked).toMatchObject({
      compatible: false,
      changes: ['configured source/schema/data/mapping'],
      observedDeclared: { data: { sha256: changed.sha256 } },
    });
    expect(checked.copy).toBeUndefined();
    expect(plan.publicData?.declaredSource?.data.sha256).toBe(
      state.fixture.data.sha256,
    );
    expect(
      state.fixture.http.mock.calls.some(
        ([url]) => String(url) === immutableUrl(changed),
      ),
    ).toBe(false);
  });
});
