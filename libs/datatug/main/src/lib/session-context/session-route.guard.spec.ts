import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  Params,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { admitSessionWorkspace } from './session-route.guard';
import { SessionWorkspaceService } from './session-workspace.service';

function fakeWorkspace(focusedId?: string) {
  return {
    openProject: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    snapshot: vi.fn(() =>
      focusedId ? { session: { id: focusedId } } : undefined,
    ),
  };
}

function route(params: Params[], queryParams: Params = {}) {
  return {
    pathFromRoot: params.map((p) => ({ params: p })),
    queryParams,
    queryParamMap: convertToParamMap(queryParams),
  } as unknown as ActivatedRouteSnapshot;
}

describe('admitSessionWorkspace', () => {
  let workspace: ReturnType<typeof fakeWorkspace>;

  const run = (snapshot: ActivatedRouteSnapshot) =>
    TestBed.runInInjectionContext(() =>
      admitSessionWorkspace(snapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  const serialize = (value: boolean | UrlTree) =>
    value instanceof UrlTree ? TestBed.inject(Router).serializeUrl(value) : value;

  function setup(focusedId?: string) {
    workspace = fakeWorkspace(focusedId);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionWorkspaceService, useValue: workspace },
      ],
    });
  }

  const project = [{ storeId: 'firestore', projectId: 'p1' }];

  it('admits a session once it is opened and focused', async () => {
    setup('s-1');
    await expect(run(route([...project, { sessionId: 's-1' }]))).resolves.toBe(true);
    expect(workspace.openProject).toHaveBeenCalledWith({
      storeId: 'firestore',
      projectId: 'p1',
    });
    expect(workspace.focus).toHaveBeenCalledWith('s-1');
  });

  it('passes the space id and project API query into the project ref', async () => {
    setup('s-1');
    await run(
      route([{ ...project[0], spaceId: 'sp' }, { sessionId: 's-1' }], {
        projectApi: 'local',
        branch: 'main',
      }),
    );
    expect(workspace.openProject).toHaveBeenCalledWith({
      storeId: 'firestore',
      projectId: 'p1',
      spaceID: 'sp',
      projectApi: 'local',
      branch: 'main',
    });
  });

  it.each([
    ['missing', {}],
    ['invalid', { sessionId: 'bad id!' }],
  ])('redirects a %s session id to the chooser without opening', async (_, params) => {
    setup('s-1');
    const result = serialize(await run(route([...project, params], { x: '1' })));
    expect(result).toBe('/store/firestore/project/p1/sessions?x=1');
    expect(workspace.openProject).not.toHaveBeenCalled();
  });

  it.each([
    ['another session is focused', 'other'],
    ['no session snapshot exists', undefined],
  ])('redirects to the chooser when %s', async (_, focused) => {
    setup(focused);
    const result = serialize(await run(route([...project, { sessionId: 's-1' }])));
    expect(result).toBe('/store/firestore/project/p1/sessions');
    expect(workspace.focus).toHaveBeenCalledWith('s-1');
  });

  it('falls back to the root chooser for an empty project ref', async () => {
    setup();
    const result = serialize(await run(route([{}])));
    expect(result).toBe('/');
  });
});
