import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { WorkApiService } from './work-api.service';
import { WorkAction } from './work.models';
import { workDetailFixture, workPageFixture } from './work.spec-helper';
describe('WorkApiService', () => {
  const scope = { spaceID: 'space', projectID: 'project' };
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let service: WorkApiService;
  beforeEach(() => {
    api = { get: vi.fn(), post: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    service = TestBed.inject(WorkApiService);
  });
  it('sends current project scope and filters through HTTP', async () => {
    api.get.mockReturnValue(of(workPageFixture()));
    await service.list(
      scope,
      { assignee: 'developer', search: 'shipment' },
      new AbortController().signal,
    );
    const [path, params] = api.get.mock.calls[0];
    expect(path).toBe('datatug/work/items');
    expect(params.get('spaceID')).toBe('space');
    expect(params.get('projectID')).toBe('project');
    expect(params.get('search')).toBe('shipment');
  });
  it('whitelists only project scope when a wider mutation object is passed to a follow-up read', async () => {
    api.get.mockReturnValue(of(workDetailFixture()));
    const wider = {
      ...scope,
      operationId: 'private-op',
      action: 'context',
      contextCommand: { value: 'private-value' },
    };
    await service.read(wider, 'task1', new AbortController().signal);
    expect(api.get.mock.calls[0][1].keys().sort()).toEqual([
      'id',
      'projectID',
      'spaceID',
    ]);
    expect(api.get.mock.calls[0][1].toString()).not.toContain('private');
  });
  it('rejects an item from another project before exposing it', async () => {
    const detail = workDetailFixture();
    detail.item = { ...detail.item, projectID: 'private' };
    api.get.mockReturnValue(of(detail));
    await expect(
      service.read(scope, 'task1', new AbortController().signal),
    ).rejects.toThrow('out-of-scope');
  });
  it('freezes the mutation and disables automatic unauthorized replay', async () => {
    const response = new Subject<ReturnType<typeof workDetailFixture>>();
    api.post.mockReturnValue(response);
    const action: WorkAction = {
      ...scope,
      operationId: 'operation1',
      action: 'comment',
      itemId: 'task1',
      expectedVersion: 1,
      comment: 'Original',
    };
    const pending = service.action(action, new AbortController().signal);
    action.comment = 'Changed';
    expect(api.post.mock.calls[0][1].comment).toBe('Original');
    expect(api.post.mock.calls[0][2]).toEqual({ retryUnauthorizedOnce: false });
    response.next(workDetailFixture());
    response.complete();
    await pending;
  });
  it('does not dispatch a command after scope cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.action(
        {
          ...scope,
          operationId: 'op',
          action: 'comment',
          itemId: 'task1',
          comment: 'No',
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('rejects malformed paging rather than silently truncating My Work', async () => {
    api.get.mockReturnValue(of({ ...workPageFixture(), hasMore: true }));
    await expect(
      service.list(scope, {}, new AbortController().signal),
    ).rejects.toThrow('Invalid Work list');
  });
  it('admits only unique title projections for actual Work peers', async () => {
    const detail = workDetailFixture();
    detail.links = [
      {
        id: 'link',
        sourceId: 'case1',
        relation: 'parent',
        target: { kind: 'work', id: 'task1' },
        createdBy: 'lead',
        createdAt: '',
      },
    ];
    detail.relatedItems = [
      { id: 'case1', type: 'case', title: 'Investigate shipment' },
    ];
    api.get.mockReturnValue(of(detail));
    expect(
      (await service.read(scope, 'task1', new AbortController().signal))
        .relatedItems?.[0].title,
    ).toBe('Investigate shipment');
    for (const relatedItems of [
      [{ id: 'unrelated', type: 'case', title: 'Private' }],
      [...detail.relatedItems, ...detail.relatedItems],
      [{ id: 'case1', type: 'watch', title: 'Not work' }],
    ]) {
      api.get.mockReturnValue(of({ ...detail, relatedItems }));
      await expect(
        service.read(scope, 'task1', new AbortController().signal),
      ).rejects.toThrow('inconsistent related work');
    }
  });
});
