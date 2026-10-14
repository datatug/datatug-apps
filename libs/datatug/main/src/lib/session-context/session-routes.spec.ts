import { datatugProjectRoutes, sessionWorkspacePages } from '../routes/datatug-routing-proj';
import { datatugRoutes } from '../routes/datatug-routing.module';
import { parseProjectUrl, tryProjectUrl } from '@datatug/project-address';
import { UrlSegment } from '@angular/router';

describe('session route boundaries', () => {
  it('adds native session stack IDs and retains the canonical legacy query wildcard', () => {
    const route = datatugProjectRoutes.find((item) => item.path === 'sessions');
    expect(route?.children?.[0].path).toBe(':sessionId');
    expect(route?.children?.[0].children?.[0].redirectTo).toBe('overview');
    expect(sessionWorkspacePages.some((item) => item.path === 'board/:board')).toBe(true);
    expect(datatugProjectRoutes.find((item) => item.path === 'query')?.children?.[0].path).toBe('**');
  });
  it('round trips a shared session query while keeping unrelated shared pages denied', () => {
    const ref = { storeId: 'firestore', projectId: 'p1', spaceID: 'space1' };
    const url = tryProjectUrl(ref, ['sessions', 's1', 'query', 'folder/query']);
    expect(url).toBe('/space/space1/store/firestore/project/p1/sessions/s1/query/folder%2Fquery');
    expect(typeof url === 'string' && parseProjectUrl(url).ok).toBe(true);
    expect(tryProjectUrl(ref, ['sessions', 's1', 'env', 'prod'])).toMatchObject({ ok: false });
    expect(tryProjectUrl(ref, ['sessions', 's1', 'chat'])).toMatchObject({ ok: false });
  });
  it('keeps the shared router matcher as narrow as the address allowlist', () => {
    const route = datatugRoutes.find((item) => item.path === 'space/:spaceId/store/:storeId/project/:projectId');
    if (!route) throw new Error('The shared project route is missing.');
    const routeGuards = route.canMatch;
    if (!routeGuards?.length) throw new Error('The shared project route has no matcher.');
    const guard = routeGuards[0] as (route: unknown, segments: UrlSegment[]) => boolean;
    const check = (rest: string) => guard(route, `space/space1/store/firestore/project/p1/${rest}`.split('/').map((segment) => new UrlSegment(segment, {})));
    expect(check('sessions/s1/queries')).toBe(true);
    expect(check('sessions/s1/query/folder/query')).toBe(false);
    expect(check('sessions/s1/env/prod')).toBe(false);
    expect(check('sessions/s1/chat')).toBe(false);
    expect(check('sessions/../queries')).toBe(false);
  });
});
