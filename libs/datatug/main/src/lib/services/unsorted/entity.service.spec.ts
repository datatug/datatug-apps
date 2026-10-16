import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';

import { EntityService } from './entity.service';
import { StoreApiService } from '../repo/store-api.service';
import { ProjectAssetsReadService } from '../project/project-assets-read.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import countryDefinition from '../../project-files/fixtures/chinook-demo/entities/Country/Country.entity.json';

describe('EntityService', () => {
  let service: EntityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EntityService,
        {
          provide: StoreApiService,
          useValue: {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn() } },
        {
          provide: ProjectAssetsReadService,
          useValue: {
            entities: vi.fn(() => of([])),
            entity: vi.fn(() => of({})),
          },
        },
      ],
    });
    service = TestBed.inject(EntityService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('does not reuse an entity-list cache for an explicitly scoped branch or actor transport', async () => {
    const assets = TestBed.inject(ProjectAssetsReadService);
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      projectApi: 'cloud' as const,
      branch: 'topic',
    };
    await firstValueFrom(service.getAllEntities(ref));
    await firstValueFrom(service.getAllEntities(ref));
    const getEntities = assets.entities as unknown as ReturnType<typeof vi.fn>;
    expect(getEntities).toHaveBeenCalledTimes(2);
    expect(getEntities).toHaveBeenCalledWith(ref);
  });

  it('hydrates the inherited fields and options of the real Country fixture', async () => {
    const assets = TestBed.inject(ProjectAssetsReadService);
    vi.mocked(assets.entity).mockReturnValue(of(countryDefinition as never));
    const http = TestBed.inject(HttpClient);
    vi.mocked(http.get).mockReturnValue(
      of({
        fields: [{ id: 'CountryCode', type: 'string' }],
        options: { sources: [] },
      } as never),
    );

    const record = await firstValueFrom(
      service.getEntity(
        {
          storeId: 'github.com',
          projectId: 'datatug-demo-projects@datatug@demo-project-1',
          branch: 'main',
        },
        'Country',
      ),
    );

    expect(http.get).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/datatug/datatug-meta-iso/main/geo/country/country.json',
    );
    expect(record.dbo?.extends?.def).toBe(countryDefinition.extends.def);
    expect(record.dbo?.fields).toEqual([{ id: 'CountryCode', type: 'string' }]);
    expect(record.dbo?.options).toEqual({ sources: [] });
  });

  it('does not fetch inherited definitions from outside raw GitHub', async () => {
    const assets = TestBed.inject(ProjectAssetsReadService);
    vi.mocked(assets.entity).mockReturnValue(
      of({
        id: 'Country',
        extends: { def: 'https://example.com/entity.json' },
        fields: [],
      }),
    );
    const http = TestBed.inject(HttpClient);
    const record = await firstValueFrom(
      service.getEntity(
        { storeId: 'github.com', projectId: 'repo@owner' },
        'Country',
      ),
    );
    expect(http.get).not.toHaveBeenCalled();
    expect(record.dbo?.extends?.def).toBe('https://example.com/entity.json');
  });

  it('cancels an inherited definition request when the full-ref read is unsubscribed', () => {
    const assets = TestBed.inject(ProjectAssetsReadService);
    vi.mocked(assets.entity).mockReturnValue(of(countryDefinition as never));
    let cancelled = false;
    const http = TestBed.inject(HttpClient);
    vi.mocked(http.get).mockReturnValue(
      new Observable(() => () => {
        cancelled = true;
      }) as never,
    );
    const subscription = service
      .getEntity(
        {
          storeId: 'github.com',
          projectId: 'datatug-demo-projects@datatug@demo-project-1',
          branch: 'main',
        },
        'Country',
      )
      .subscribe();
    subscription.unsubscribe();
    expect(cancelled).toBe(true);
  });
});
