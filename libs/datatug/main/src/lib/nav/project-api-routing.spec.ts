import { projectUrl } from './nav-models';
import { readProjectApiQuery, projectApiQuery } from './project-api-routing';
import { equalProjectRef } from '../core/project-context';

describe('Explicit common API route scope', () => {
  it('preserves transport and selected branch on overview/sidebar/query links and cold-load parsing', () => {
    const ref = {
      storeId: 'github.com',
      projectId: 'repo@owner@folder',
      projectApi: 'cloud' as const,
      branch: 'feature/work',
    };
    for (const page of [undefined, 'queries', ['query', 'folder/q']]) {
      const url = new URL(projectUrl(ref, page), 'https://datatug.app');
      expect(readProjectApiQuery(url.searchParams)).toEqual({
        projectApi: 'cloud',
        branch: 'feature/work',
      });
    }
    expect(equalProjectRef(ref, { ...ref, branch: 'other' })).toBe(false);
    expect(equalProjectRef(ref, { ...ref, projectApi: undefined })).toBe(false);
  });
  it('leaves public anonymous addresses unchanged and supports explicit local transport', () => {
    expect(
      projectApiQuery({
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
      }),
    ).toBe('');
    expect(
      readProjectApiQuery(new URLSearchParams('projectApi=local&branch=work')),
    ).toEqual({ projectApi: 'local', branch: 'work' });
    expect(
      projectUrl(
        {
          storeId: 'http-localhost:8989',
          projectId: 'project',
          projectApi: 'local',
          branch: 'work',
        },
        'queries',
      ),
    ).toContain('projectApi=local&branch=work');
  });
  it.each([
    'projectApi=other&branch=main',
    'projectApi=cloud&projectApi=cloud&branch=main',
    'projectApi=cloud',
    'projectApi=cloud&branch=',
    'projectApi=cloud&branch=a&branch=b',
  ])(
    'refuses malformed qualifiers rather than becoming anonymous: %s',
    (query) => {
      expect(() => readProjectApiQuery(new URLSearchParams(query))).toThrow();
    },
  );
  it('refuses a mismatched transport before producing a usable address', () => {
    expect(() =>
      projectApiQuery({
        storeId: 'http-localhost:8989',
        projectId: 'q',
        projectApi: 'cloud',
        branch: 'work',
      }),
    ).toThrow();
    expect(() =>
      projectApiQuery({
        storeId: 'github.com',
        projectId: 'repo@owner',
        projectApi: 'local',
        branch: 'work',
      }),
    ).toThrow();
  });
});
