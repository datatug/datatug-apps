import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ProjectItemTagsComponent } from './project-item-tags.component';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
describe('local project item tags', () => {
  const ref = { storeId: 'http-localhost:8989', projectId: 'demo' };
  const snapshot = {
    kind: 'board',
    id: 'b',
    tags: ['ops'],
    revision: 'r1',
    branchHead: 'h1',
  };
  function setup(branch = 'main', selectedBranch?: string) {
    const get = vi.fn((_url: string, _options: { params: HttpParams }) => {
      void _url;
      void _options;
      return of(snapshot);
    });
    const put = vi.fn((_url: string, _body: unknown) => {
      void _url;
      void _body;
      return of({ ...snapshot, tags: [], revision: 'r2' });
    });
    const api = {
      capabilities: vi.fn(() => of({ boardTags: true })),
      branches: vi.fn(() => of({ currentBranch: branch })),
    };
    TestBed.configureTestingModule({
      imports: [ProjectItemTagsComponent],
      providers: [
        { provide: HttpClient, useValue: { get, put } },
        { provide: ProjectQueryApiService, useValue: api },
      ],
    });
    TestBed.overrideComponent(ProjectItemTagsComponent, {
      set: {
        imports: [],
        template:
          '{{ message() }} {{ error() }} @for (tag of tags(); track tag) { <span>{{ tag }}</span> }',
      },
    });
    const fixture = TestBed.createComponent(ProjectItemTagsComponent);
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      ...(selectedBranch ? { branch: selectedBranch } : {}),
    });
    fixture.componentRef.setInput('kind', 'board');
    fixture.componentRef.setInput('itemId', 'b');
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, get, put, api };
  }
  it('resolves the current branch for unqualified routes and persists removing the last tag', async () => {
    const { component, get, put } = setup();
    await vi.waitFor(() => expect(component.snapshot()).toBeDefined());
    expect(get.mock.calls[0][1].params.get('branch')).toBe('main');
    component.tags.set([]);
    await component.save();
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining('/datatug/projects/item_tags'),
      expect.objectContaining({
        branch: 'main',
        tags: [],
        ifMatch: 'r1',
        expectedBranchHead: 'h1',
      }),
    );
    expect(component.message()).toBe('Tags saved.');
    expect(component.changed()).toBe(false);
    component.reload();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('refuses an explicit branch mismatch before reading or saving', async () => {
    const { component, get } = setup('main', 'other');
    await vi.waitFor(() => expect(component.error()).toBeTruthy());
    expect(get).not.toHaveBeenCalled();
    expect(component.writable()).toBe(false);
    expect(component.error()).toBeTruthy();
  });
  it('preserves the draft on a conflicting save', async () => {
    const { component, put } = setup();
    await vi.waitFor(() => expect(component.snapshot()).toBeDefined());
    put.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    component.tags.set(['new']);
    await component.save();
    expect(component.tags()).toEqual(['new']);
    expect(component.snapshot()?.revision).toBe('r1');
    expect(component.error()).toContain('draft is preserved');
  });
  it('does not repaint stale private metadata after project navigation', async () => {
    const { fixture, component, get } = setup();
    await vi.waitFor(() => expect(component.snapshot()).toBeDefined());
    const delayed = new Subject<typeof snapshot>();
    get.mockReturnValue(delayed);
    component.reload();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github',
      projectId: 'public',
    });
    fixture.detectChanges();
    delayed.next({ ...snapshot, tags: ['private'] });
    await fixture.whenStable();
    expect(component.tags()).toEqual([]);
    expect(component.writable()).toBe(false);
  });
});
