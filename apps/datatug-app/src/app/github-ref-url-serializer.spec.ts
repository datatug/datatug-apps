import { describe, expect, it } from 'vitest';
import { GithubRefUrlSerializer } from './github-ref-url-serializer';

const serializer = new GithubRefUrlSerializer();
const repoParameters = (url: string) =>
  serializer.parse(url).root.children['primary'].segments[3]?.parameters;

describe('GithubRefUrlSerializer (founder 2026-10-23: a GitHub project ref is `?ref=`)', () => {
  it.each([
    ['/project/github.com/o/r?ref=main', 'main'],
    ['/project/github.com/o/r/d/-/queries?ref=feature/x', 'feature/x'],
    ['/project/github.com/o/r/d?ref=feature%2Fx', 'feature/x'],
    ['/Project/GitHub.com/o/r/d?q=a&ref=v1&x=1', 'v1'],
    ['/project/github.com/o/r/d?ref=HEAD', 'HEAD'],
  ])('%s: the ref is the repository segment\'s matrix parameter inside the router', (url, ref) => {
    const tree = serializer.parse(url);
    expect(tree.root.children['primary'].segments[3].parameters).toEqual({ ref });
    expect(tree.queryParams['ref']).toBeUndefined();
  });

  it.each([
    ['/project/github.com/o/r/d?ref=feature%2Fx', '/project/github.com/o/r/d?ref=feature/x'],
    ['/project/github.com/o/r/d/-/queries?ref=main', '/project/github.com/o/r/d/-/queries?ref=main'],
    [
      '/project/github.com/o/r/d/-/quick-search?q=Customer&ref=v1#f',
      '/project/github.com/o/r/d/-/quick-search?q=Customer&ref=v1#f',
    ],
    ['/project/github.com/o/r/d?ref=rel%201', '/project/github.com/o/r/d?ref=rel%201'],
    ['/project/github.com/o/r/d', '/project/github.com/o/r/d'],
  ])('%s is written back as %s', (url, written) => {
    expect(serializer.serialize(serializer.parse(url))).toBe(written);
  });

  it('keeps the ref through a relative navigation: the repository segment carries it', () => {
    const tree = serializer.parse('/project/github.com/o/r/d/-/queries?ref=v1');
    const segments = tree.root.children['primary'].segments;
    segments.splice(6, 1, ...serializer.parse('/boards').root.children['primary'].segments);
    expect(serializer.serialize(tree)).toBe('/project/github.com/o/r/d/-/boards?ref=v1');
  });

  it.each([
    '/store/github.com/project/r@o/queries?ref=v1',
    '/projects/github.com/o/r?ref=v1',
    '/project/gitlab.com/o/r?ref=v1',
    '/project/github.com/o?ref=v1',
    '/quick-search?ref=v1',
  ])('%s is not a GitHub project address: the default serializer\'s', (url) => {
    expect(serializer.parse(url).queryParams['ref']).toBe('v1');
    expect(serializer.serialize(serializer.parse(url))).toBe(url);
  });

  it('leaves two refs in the query, where the address check refuses them', () => {
    const tree = serializer.parse('/project/github.com/o/r?ref=a&ref=b');
    expect(tree.queryParams['ref']).toEqual(['a', 'b']);
    expect(repoParameters('/project/github.com/o/r?ref=a&ref=b')).toEqual({});
  });

  it('leaves a query ref beside a matrix ref in the query', () => {
    const tree = serializer.parse('/project/github.com/o/r;ref=a/d?ref=b');
    expect(tree.root.children['primary'].segments[3].parameters).toEqual({ ref: 'a' });
    expect(tree.queryParams['ref']).toBe('b');
  });
});
