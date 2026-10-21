import { UrlSegment } from '@angular/router';
import { datatugRoutes } from '../routes/datatug-routing.module';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { projectTagHref, projectTagLink } from './tag-navigation';
import { ProjectTagsCloudComponent } from './project-tags-cloud.component';
import { HostedBoardScope } from '../board/core/hosted-board-scope';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { QueriesService } from '../queries/queries.service';
import { DbServerService } from '../services/unsorted/db-server.service';
import { datatugProjectRoutes } from '../routes/datatug-routing-proj';

const ref = {
  storeId: 'http-localhost:8989',
  projectId: 'A',
  projectApi: 'local' as const,
  branch: 'main',
};
it('encodes a tag as one exact path segment and retains its project transport', () => {
  const tag = 'Ops / É?#';
  const link = projectTagLink(ref, tag);
  const serializer = new DefaultUrlSerializer();
  expect(serializer.serialize(link)).toBe(projectTagHref(ref, tag));
  const segments = link.root.children['primary'].segments;
  expect(segments.at(-1)?.path).toBe(tag);
  expect(segments.at(-2)?.path).toBe('tag');
  expect(link.queryParams).toEqual({ projectApi: 'local', branch: 'main' });
  expect(
    datatugProjectRoutes.find((route) => route.path === 'tag/:tag')
      ?.loadComponent,
  ).toBeTypeOf('function');
});

it('uses exact matching item identities, keeps failed kinds unknown, and clears stale project catalogs', async () => {
  const a = new Subject<{ id: string; title: string; tags: string[] }[]>();
  const b = new Subject<{ id: string; title: string; tags: string[] }[]>();
  const identity = signal('account-a');
  const boards = vi.fn((target) => (target.projectId === 'A' ? a : b));
  TestBed.configureTestingModule({
    imports: [ProjectTagsCloudComponent],
    providers: [
      {
        provide: HostedBoardScope,
        useValue: {
          environment: signal(''),
          admitted: signal(false),
          page: { identity },
          refresh: vi.fn(),
        },
      },
      { provide: ProjectAssetsReadService, useValue: { boards } },
      {
        provide: QueriesService,
        useValue: {
          getQueriesFolder: () =>
            of({
              id: '~',
              folders: [
                {
                  id: 'nested',
                  items: [{ id: 'q', title: 'Query', tags: ['Ops'] }],
                },
              ],
            }),
        },
      },
      {
        provide: DbServerService,
        useValue: { getDbServers: () => throwError(() => new Error('403')) },
      },
    ],
  });
  TestBed.overrideComponent(ProjectTagsCloudComponent, {
    set: { providers: [], imports: [], template: '{{ selectedTag() }}' },
  });
  const fixture = TestBed.createComponent(ProjectTagsCloudComponent);
  fixture.componentRef.setInput('projectRef', ref);
  fixture.componentRef.setInput('selectedTag', 'Ops');
  fixture.detectChanges();
  a.next([{ id: 'b', title: 'Board', tags: ['Ops'] }]);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  expect(component.matchingItems('boards').map((item) => item.id)).toEqual([
    'b',
  ]);
  expect(component.matchingItems('queries').map((item) => item.id)).toEqual([
    'nested/q',
  ]);
  const queryLink = component.itemHref(
    'queries',
    component.matchingItems('queries')[0],
  );
  expect(queryLink.queryParams).toEqual({
    projectApi: 'local',
    branch: 'main',
    id: 'nested/q',
  });
  expect(component.href('queries', 'Ops').queryParams).toEqual({
    projectApi: 'local',
    branch: 'main',
    tag: 'Ops',
    tab: 'shared',
  });
  expect(component.catalog().servers.items).toBeUndefined();
  expect(component.catalog().servers.error).toBeTruthy();
  fixture.componentRef.setInput('projectRef', { ...ref, projectId: 'B' });
  await fixture.whenStable();
  expect(component.catalog().boards.items).toBeUndefined();
  a.next([{ id: 'stale', title: 'Stale', tags: ['Ops'] }]);
  expect(component.matchingItems('boards')).toEqual([]);
  b.next([{ id: 'new', title: 'New', tags: ['Ops'] }]);
  await fixture.whenStable();
  expect(component.matchingItems('boards').map((item) => item.id)).toEqual([
    'new',
  ]);
  fixture.componentRef.setInput('selectedTag', 'ops');
  await fixture.whenStable();
  expect(component.matchingItems('boards')).toEqual([]);
  expect(boards).toHaveBeenCalledTimes(2);
  identity.set('account-b');
  await fixture.whenStable();
  expect(component.catalog().boards.items).toBeUndefined();
  expect(boards).toHaveBeenCalledTimes(3);
  component.reload();
  await fixture.whenStable();
  expect(boards).toHaveBeenCalledTimes(4);
  fixture.componentRef.setInput('projectRef', {
    storeId: 'firestore',
    spaceID: 'S',
    projectId: 'P',
  });
  fixture.componentRef.setInput('selectedTag', 'Ops');
  await fixture.whenStable();
  const sharedQuery = component.itemHref(
    'queries',
    component.matchingItems('queries')[0],
  );
  expect(new DefaultUrlSerializer().serialize(sharedQuery)).toBe(
    '/space/S/store/firestore/project/P/query/nested%2Fq?id=nested%2Fq',
  );
});

it('admits tag lists and encoded detail segments only inside an admitted shared project route', () => {
  const route = datatugRoutes.find(
    (route) =>
      route.path === 'space/:spaceId/store/:storeId/project/:projectId',
  );
  const guard = route?.canMatch?.[0] as (
    route: unknown,
    segments: UrlSegment[],
  ) => boolean;
  const segments = (space: string, rest: string[]) =>
    ['space', space, 'store', 'firestore', 'project', 'P', ...rest].map(
      (path) => new UrlSegment(path, {}),
    );
  expect(guard(route, segments('S', ['tags']))).toBe(true);
  expect(guard(route, segments('S', ['tag']))).toBe(true);
  expect(route?.children?.some(child => child.path === 'tag')).toBe(true);
  expect(guard(route, segments('S', ['tag', 'Ops / É?#']))).toBe(true);
  expect(guard(route, segments('/', ['tag', 'Ops']))).toBe(false);
  expect(guard(route, segments('S', ['tag', 'x'.repeat(51)]))).toBe(false);
  expect(route?.children?.some((child) => child.path === 'tag/:tag')).toBe(
    true,
  );
});
it.each(['.', '..', 'a//b', 'team/', 'Ops / É?#', 'Case'])(
  'round-trips accepted opaque tag %s for local and shared projects without root fallback',
  (tag) => {
    for (const target of [
      ref,
      { storeId: 'firestore', spaceID: 'S', projectId: 'P' },
    ]) {
      const link = projectTagLink(target, tag);
      const address = new URL(
        new DefaultUrlSerializer().serialize(link),
        'https://example.test',
      );
      expect(address.pathname).not.toBe('/');
      expect(
        address.searchParams.get('tag') ??
          decodeURIComponent(address.pathname.split('/').at(-1) ?? ''),
      ).toBe(tag);
      expect(link.queryParams['projectApi']).toBe(
        target === ref ? 'local' : undefined,
      );
    }
  },
);
