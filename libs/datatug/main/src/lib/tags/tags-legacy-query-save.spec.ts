import { createSemanticModel } from '../queries/semantic-mapping';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { firstValueFrom, of } from 'rxjs';
import { QueryEditorStateService } from '../queries/query-editor-state-service';
import { QueriesService } from '../queries/queries.service';
import { ProjectService } from '../services/project/project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  QueryType,
  ITextQueryRequest,
  IQueryDef,
} from '../models/definition/query-def';
import { ProjectQuerySave } from '../services/project/project-query-api.service';
describe('unqualified local query tag saves', () => {
  const ref = { storeId: 'http-localhost:8989', projectId: 'demo' };
  const def = {
    id: 'q',
    title: 'Query',
    tags: ['ops'],
    request: {
      queryType: QueryType.SQL,
      text: 'SELECT 1',
    } as ITextQueryRequest,
  };
  function setup(stale = false, withMeanings = false, semanticSupport = true) {
    const savedDef: IQueryDef = withMeanings
      ? {
          ...def,
          semanticModel: createSemanticModel({
            queryHash: 'a'.repeat(64),
            resultIndex: 0,
            columns: [],
          }),
        }
      : def;
    const saveRevision = vi.fn((_ref: unknown, write: ProjectQuerySave) =>
      of({
        query: { ...write.query },
        revision: 'r2',
        branchHead: 'h2',
        saveSupported: true,
      }),
    );
    const updateQuery = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        QueryEditorStateService,
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: QueriesService,
          useValue: {
            branches: () =>
              of({
                currentBranch: 'main',
                branches: [{ name: 'main', head: 'h1' }],
              }),
            capabilities: () =>
              of({ querySave: true, semanticModel: semanticSupport }),
            getRevision: () =>
              of({
                query: {
                  folderPath: '~',
                  id: 'q',
                  title: 'Query',
                  tags: ['ops'],
                  type: QueryType.SQL,
                  text: stale ? 'SELECT 2' : 'SELECT 1',
                  ...('semanticModel' in savedDef
                    ? { semanticModel: savedDef.semanticModel }
                    : {}),
                },
                revision: 'r1',
                branchHead: 'h1',
                saveSupported: true,
              }),
            saveRevision,
            updateQuery,
          },
        },
        {
          provide: ProjectService,
          useValue: { getFull: () => of({ environments: [] }) },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of({ ref }), currentEnv: of(undefined) },
        },
      ],
    });
    const service = TestBed.inject(QueryEditorStateService);
    service.newQuery({
      id: 'q',
      queryType: QueryType.SQL,
      def: savedDef,
      title: 'Query',
      request: def.request,
      isNew: false,
    });
    const state = {
      ...service.getQueryState('q'),
      id: 'q',
      queryType: QueryType.SQL,
      def: savedDef,
      request: def.request,
      title: 'Query',
      tags: [],
    };
    service.updateQueryState(state);
    return { service, state, saveRevision, updateQuery };
  }
  it('pins the actual branch and saves remove-all using a verified unchanged revision', async () => {
    const { service, state, saveRevision, updateQuery } = setup();
    await firstValueFrom(service.saveQuery(state, ref));
    expect(updateQuery).not.toHaveBeenCalled();
    expect(saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'main', projectApi: 'local' }),
      expect.objectContaining({
        query: expect.objectContaining({
          tags: [],
          type: 'SQL',
          text: 'SELECT 1',
        }),
        ifMatch: 'r1',
        expectedBranchHead: 'h1',
      }),
    );
    expect(service.getQueryState('q')?.def?.tags).toEqual([]);
    expect(service.getQueryState('q')?.tags).toBeUndefined();
  });
  it('preserves existing meanings and remove-all tags through the qualified revision upgrade', async () => {
    const { service, state, saveRevision, updateQuery } = setup(false, true);
    await firstValueFrom(service.saveQuery(state, ref));
    expect(updateQuery).not.toHaveBeenCalled();
    expect(saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({ projectApi: 'local', branch: 'main' }),
      expect.objectContaining({
        query: expect.objectContaining({
          semanticModel: state.def.semanticModel,
          tags: [],
        }),
        ifMatch: 'r1',
        expectedBranchHead: 'h1',
      }),
    );
    expect(service.getQueryState('q')?.def?.semanticModel).toEqual(
      state.def.semanticModel,
    );
    expect(service.getQueryState('q')?.def?.tags).toEqual([]);
  });
  it('keeps meanings fail-closed if the upgraded local provider lacks semantic support', async () => {
    const { service, state, saveRevision } = setup(false, true, false);
    await expect(firstValueFrom(service.saveQuery(state, ref))).rejects.toThrow(
      'does not support meanings',
    );
    expect(saveRevision).not.toHaveBeenCalled();
    expect(service.getQueryState('q')?.tags).toEqual([]);
  });
  it('preserves the draft and refuses a changed saved base', async () => {
    const { service, state, saveRevision } = setup(true);
    await expect(
      firstValueFrom(service.saveQuery(state, ref)),
    ).rejects.toThrow();
    expect(saveRevision).not.toHaveBeenCalled();
    expect(service.getQueryState('q')?.tags).toEqual([]);
    expect(service.getQueryState('q')?.saveError).toContain(
      'draft is preserved',
    );
  });
});
