import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PublicDataPageComponent } from './public-data-page.component';
import {
  PublicDataService,
  type PublicDataDiscovery,
} from './public-data.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { QueriesService } from '../queries.service';
import {
  FederatedQueryService,
  type FederatedQueryResult,
} from '../federated-query.service';
import { QueryType, type IQueryDef } from '../../models/definition/query-def';
import { INITIAL_CANONICAL_PINS } from './canonical-metadata';
import {
  type PublicDataSuggestion,
  type RepresentationContract,
  type SourceField,
  REPRESENTATION_PUBLICATION_BLOCKER,
} from './representation-discovery';
import { type PublicDataScenario } from './public-data-scenario';
import contractDocument from '../fixtures/public-data-fabric/representation/contract.json';
import type { IProjectContext } from '../../nav/nav-models';
import { ConfiguredPublicDataSourcesService } from './configured-public-data-sources.service';
import { publicDataExceptions } from './public-data-scenario';

const contract = contractDocument.contracts[0] as RepresentationContract;
const source = contract.source as SourceField;
function scenario(eligible: boolean): PublicDataScenario {
  const own = { ...INITIAL_CANONICAL_PINS.directory, path: 'fixture.json' };
  return {
    source,
    canonical: INITIAL_CANONICAL_PINS,
    attachment: own,
    snapshot: own,
    model: own,
    meaning: INITIAL_CANONICAL_PINS.meanings,
    decision: own,
    decisionScope: 'fixture-only',
    namespace: contract.target.namespace,
    projection: 'identity',
    equality: 'utf8-byte-exact',
    rights: {
      source: 'fixture licence',
      model: 'fixture model licence',
      meaning: 'fixture meaning licence',
      attribution: 'fixture only',
    },
    observedAt: '2026-10-05T00:00:00Z',
    eligible,
    unavailableReason: REPRESENTATION_PUBLICATION_BLOCKER,
  };
}

describe('Public data route fixture UI journey (no deployed runtime claims)', () => {
  async function setup(eligible: boolean) {
    const projectChanges = new Subject<IProjectContext>();
    const suggestion: PublicDataSuggestion = {
      provider: { title: 'Synthetic fixture provider' },
      attachment: scenario(eligible).attachment,
      contract,
      matchesSource: true,
      eligible,
      reason: eligible
        ? 'Explicit hypothetical UI fixture admission; no production acceptance.'
        : REPRESENTATION_PUBLICATION_BLOCKER,
      rights: scenario(eligible).rights,
      snapshot: {},
    };
    const discovery: PublicDataDiscovery = {
      indexes: {
        pins: INITIAL_CANONICAL_PINS,
        bytes: 10,
        directory: {},
        models: {},
        meanings: {},
      },
      metadataBytes: 10,
      suggestions: [suggestion],
    };
    const definition = {
      id: 'fixture-saved-query',
      request: { queryType: QueryType.DTQL, text: '{}' },
      federation: { ovdbBaseUrl: 'https://demodb.dev/ovdb', tables: [] },
      publicData: scenario(eligible),
    } as IQueryDef;
    const metadata = {
      discover: vi.fn(async () => discovery),
      scenario: vi.fn(() => definition),
    };
    const output = {
      recordset: {
        columns: [{ name: 'Country' }],
        rows: [[{ value: 'USA' }], [{ value: null }]],
      },
      provenance: {
        source: 'bounded runtime fixture',
        observedAt: '2026-10-05',
      },
      limitations: [],
      publicDataBytes: 80,
      publicDataExceptions: {
        denominator: 2,
        nonNull: 1,
        null: 1,
        empty: 0,
        invalid: 0,
        unmatched: 0,
        ambiguous: 0,
        matched: 1,
        multiplied: 0,
        details: [
          {
            key: '1',
            raw: 'USA',
            projected: ['US'],
            status: 'matched',
            matches: 1,
          },
          { key: '2', raw: null, projected: [], status: 'NULL', matches: 0 },
        ],
      },
    } as unknown as FederatedQueryResult;
    const federation = {
      run: vi.fn(async () => output),
      dispose: vi.fn(async () => undefined),
      getPage: vi.fn(),
    };
    let reopened: IQueryDef | undefined;
    const queries = {
      createQuery: vi.fn((_ref, query: IQueryDef) =>
        of(structuredClone(query)),
      ),
    };
    const navigation = {
      goTable: vi.fn(),
      goQuery: vi.fn((_project, query: IQueryDef) => {
        reopened = structuredClone(query);
      }),
    };
    const connection = {
      id: 'fixture-source',
      title: 'Configured fixture source',
      environment: 'fixture',
      catalog: 'user',
      driver: 'ovdb',
      host: 'https://fixture.invalid/api',
    };
    const configured = {
      list: vi.fn(async () => [connection]),
      inspect: vi.fn(async () => ({
        discovery,
        fields: [
          {
            id: 'Customer.Country',
            table: { schema: '', name: 'Customer', dbType: 'BASE TABLE' },
            property: 'Country',
            source,
            reason: 'Scope resolved from immutable canonical fixture metadata.',
          },
        ],
      })),
    };
    await TestBed.configureTestingModule({
      imports: [PublicDataPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: PublicDataService, useValue: metadata },
        { provide: ConfiguredPublicDataSourcesService, useValue: configured },
        { provide: FederatedQueryService, useValue: federation },
        { provide: QueriesService, useValue: queries },
        { provide: DatatugNavService, useValue: navigation },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: projectChanges },
        },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<PublicDataPageComponent> =
      TestBed.createComponent(PublicDataPageComponent);
    fixture.detectChanges();
    // Emit after initial render; zoneless DOM assertions wait for stability.
    projectChanges.next({
      ref: { storeId: 'github.com', projectId: 'fixture@example@' },
    });
    fixture.componentInstance.sourceText.set(JSON.stringify(source));
    await fixture.whenStable();
    const click = async (label: string) => {
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('ion-button'),
      ) as HTMLElement[];
      const button = buttons.find(
        (value) => value.textContent?.trim() === label,
      );
      expect(button).toBeDefined();
      button?.click();
      await fixture.whenStable();
    };
    return {
      fixture,
      federation,
      metadata,
      queries,
      navigation,
      click,
      configured,
      reopened: () => reopened,
    };
  }
  it('connects, explains exact provenance, inspects, explicitly runs, shows exceptions, saves and reopens the exact query pins', async () => {
    const state = await setup(true);
    expect(state.federation.run).not.toHaveBeenCalled();
    state.fixture.componentInstance.sourceText.set('');
    await state.click('Load configured sources');
    const connection = state.fixture.nativeElement.querySelector(
      '#fabric-connection',
    ) as HTMLSelectElement;
    connection.value = 'fixture-source';
    connection.dispatchEvent(new Event('change'));
    await state.fixture.whenStable();
    const field = state.fixture.nativeElement.querySelector(
      '#fabric-field',
    ) as HTMLSelectElement;
    field.value = 'Customer.Country';
    field.dispatchEvent(new Event('change'));
    await state.fixture.whenStable();
    expect(state.fixture.componentInstance.sourceText()).toBe('');
    expect(state.fixture.componentInstance.source()).toEqual(source);
    expect(state.configured.inspect).toHaveBeenCalledOnce();
    expect(state.fixture.nativeElement.textContent).toContain(
      'Customer.Country',
    );
    expect(state.fixture.nativeElement.textContent).toContain(
      'UTF8 byte-exact equality',
    );
    expect(state.fixture.nativeElement.textContent).toContain(
      'fixture licence',
    );
    expect(state.federation.run).not.toHaveBeenCalled();
    await state.click('Inspect this lookup');
    expect(state.federation.run).not.toHaveBeenCalled();
    await state.click('Run bounded lookup');
    expect(state.federation.run).toHaveBeenCalledTimes(1);
    expect(
      state.fixture.nativeElement.querySelector(
        '[data-testid="exception-counts"]',
      ).textContent,
    ).toContain('NULL 1');
    expect(state.fixture.nativeElement.textContent).toContain('USA');
    await state.click('Save pending scenario');
    expect(state.navigation.goQuery).toHaveBeenCalledTimes(1);
    expect(state.reopened()?.publicData).toEqual(scenario(true));
    expect(state.reopened()?.federation).toEqual(
      state.metadata.scenario.mock.results[0].value.federation,
    );
    expect(state.federation.run).toHaveBeenCalledTimes(1); // save/reopen performs no implicit lookup
  });
  it('renders production publication unavailable and refuses programmatic execution', async () => {
    const state = await setup(false);
    await state.click('Connect and explain');
    await state.click('Inspect this lookup');
    expect(state.fixture.nativeElement.textContent).toContain(
      REPRESENTATION_PUBLICATION_BLOCKER,
    );
    const run = Array.from(
      state.fixture.nativeElement.querySelectorAll('ion-button'),
    ).find(
      (value) =>
        (value as HTMLElement).textContent?.trim() === 'Run bounded lookup',
    ) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    await state.fixture.componentInstance.run();
    await state.fixture.whenStable();
    expect(state.federation.run).not.toHaveBeenCalled();
  });
  it('leads with readable availability while preserving immutable coordinates in closed expandable provenance', async () => {
    const state = await setup(false);
    await state.click('Connect and explain');
    const root = state.fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="source-availability"]')?.textContent,
    ).toContain('Public release date and coverage: unknown');
    for (const selector of ['canonical-provenance', 'execution-limits']) {
      const details = root.querySelector(
        `[data-testid="${selector}"]`,
      ) as HTMLDetailsElement;
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')).toBeTruthy();
    }
    const provenance = root.querySelector(
      '[data-testid="canonical-provenance"]',
    ) as HTMLDetailsElement;
    expect(provenance.textContent).toContain(
      INITIAL_CANONICAL_PINS.directory.revision,
    );
    expect(provenance.textContent).toContain(
      INITIAL_CANONICAL_PINS.directory.sha256,
    );
    expect(provenance.textContent).toContain('2097152 bytes');
    expect(
      root.querySelector('[data-testid="execution-limits"]')?.textContent,
    ).toContain('5MiB');
    provenance.querySelector('summary')?.click();
    expect(provenance.open).toBe(true);
    expect(state.federation.run).not.toHaveBeenCalled();
  });
  it('renders snapshot status warnings and keeps repeated affiliations separate from child locations', async () => {
    const state = await setup(false);
    const raw = 'https://ror.org/0042xzm63';
    const counts = publicDataExceptions(
      {
        userRows: 1000,
        userOffset: 0,
        identifierKind: 'ror',
        nativeNamespace: 'ROR:URL',
        identifierLimit: 50,
        resultRows: 5000,
        bytes: 5242880,
        timeoutMs: 10000,
        sources: [
          { database: 'user', name: 'Affiliation', keyField: 'ror_id' },
          {
            database: 'ror',
            name: 'organizations',
            keyField: 'id',
            parent: { database: 'user', name: 'Affiliation', field: 'ror_id' },
          },
        ],
      },
      new Map([
        [
          'user.Affiliation',
          [
            { key: 'a1', data: { ror_id: raw } },
            { key: 'a2', data: { ror_id: raw } },
            { key: 'w', data: { ror_id: 'https://ror.org/0006jh821' } },
            { key: 'i', data: { ror_id: 'https://ror.org/00067tc54' } },
          ],
        ],
        [
          'ror.organizations',
          [
            {
              key: raw,
              data: {
                id: raw,
                status: 'active',
                locations: [{ ordinal: 0 }, { ordinal: 1 }],
              },
            },
            {
              key: 'w',
              data: { id: 'https://ror.org/0006jh821', status: 'withdrawn' },
            },
            {
              key: 'i',
              data: { id: 'https://ror.org/00067tc54', status: 'inactive' },
            },
          ],
        ],
      ]),
    );
    state.fixture.componentInstance.result.set({
      recordset: { columns: [], rows: [] },
      provenance: { source: 'ROR rendering fixture', observedAt: '2026-09-22' },
      limitations: [],
      publicDataExceptions: counts,
    } as unknown as FederatedQueryResult);
    await state.fixture.whenStable();
    const text = state.fixture.nativeElement.textContent;
    expect(text).toContain('matched 4');
    expect(text).toContain('multiplied 0');
    expect(text).toContain('child locations do not increase');
    expect(text).toContain('erroneous, duplicate or out-of-scope');
    expect(text).toContain('historical reference context');
    expect(state.federation.run).not.toHaveBeenCalled();
  });
});
