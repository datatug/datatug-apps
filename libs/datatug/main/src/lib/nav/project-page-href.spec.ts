import { describe, expect, it } from 'vitest';
import { projectPageHref } from './project-page-href';

describe('projectPageHref (G-A1c)', () => {
  it.each([
    // [store id, project id, page, the address]
    [
      'github.com',
      'chinook-demo@datatug@',
      undefined,
      '/project/github.com/datatug/chinook-demo',
    ],
    [
      'github.com',
      'chinook-demo@datatug@',
      'queries',
      '/project/github.com/datatug/chinook-demo/queries',
    ],
    [
      'github',
      'r@o@d',
      'entities',
      '/project/github.com/o/r/tree/HEAD/d/-/entities',
    ],
    [
      'github.com',
      'r@o@@v1.0.0',
      ['query', 'a/b'],
      '/project/github.com/o/r/tree/v1.0.0/-/query/a%2Fb',
    ],
    ['localhost:8989', 'p1', undefined, '/store/localhost:8989/project/p1'],
    [
      'localhost:8989',
      'p1',
      'queries',
      '/store/localhost:8989/project/p1/queries',
    ],
    [
      'http://localhost:8989',
      'p1',
      'entities',
      '/store/http-localhost:8989/project/p1/entities',
    ],
    ['firestore', 'p1', 'entities', '/store/firestore/project/p1/entities'],
  ])('%s project %s page %j is at %s', (storeId, projectId, page, address) => {
    expect(projectPageHref({ storeId, projectId }, page)).toBe(address);
  });

  it.each([
    ['no project yet', undefined],
    [
      'a project with no exact address',
      { storeId: 'localhost:8989', projectId: '50%' },
    ],
    ['a project without a store', { storeId: '', projectId: 'p1' }],
  ])('is the root for %s', (_name, ref) => {
    expect(projectPageHref(ref, 'queries')).toBe('/');
  });
});
