import { UrlSegment } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  GithubRefUrlHandlingStrategy,
  GithubRefUrlSerializer,
  liftProjectQuery,
} from './github-ref-url-serializer';

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

describe('liftProjectQuery: a project href given to [routerLink] as one string command', () => {
  it('lifts ?ref= (and the other parameters) out of the last segment', () => {
    const tree = serializer.parse('/project/github.com/o/r/d/-/x');
    const segments = tree.root.children['primary'].segments;
    // What RouterLink builds from the command '/project/github.com/o/r/d/-/environments?ref=feature/x&id=a'.
    segments[segments.length - 1] = new UrlSegment('environments?ref=feature/x&id=a', {});
    const lifted = liftProjectQuery(tree);
    expect(lifted.root.children['primary'].segments.map((s) => s.path)).toEqual([
      'project', 'github.com', 'o', 'r', 'd', '-', 'environments',
    ]);
    expect(lifted.root.children['primary'].segments[3].parameters).toEqual({ ref: 'feature/x' });
    expect(lifted.queryParams).toEqual({ id: 'a' });
    expect(serializer.serialize(tree)).toBe('/project/github.com/o/r/d/-/environments?id=a&ref=feature/x');
    expect(new GithubRefUrlHandlingStrategy().extract(tree)).toEqual(lifted);
  });

  it('rejoins a ref that RouterLink split at its slash, and keeps the link\'s own query', () => {
    const tree = serializer.parse('/project/github.com/o/r/d/-/query/albums/x?id=albums%2Fx');
    const segments = tree.root.children['primary'].segments;
    // RouterLink's split of '…/-/query/albums/x?ref=renovate/actions-checkout-3.x'
    segments.splice(8, 1, new UrlSegment('x?ref=renovate', {}), new UrlSegment('actions-checkout-3.x', {}));
    expect(serializer.serialize(tree)).toBe(
      '/project/github.com/o/r/d/-/query/albums/x?id=albums%2Fx&ref=renovate/actions-checkout-3.x',
    );
  });

  it('lifts it from the repository segment itself (a root project href)', () => {
    const tree = serializer.parse('/project/github.com/o/x');
    tree.root.children['primary'].segments[3] = new UrlSegment('r?ref=v1', {});
    expect(serializer.serialize(tree)).toBe('/project/github.com/o/r?ref=v1');
  });

  it('leaves a page segment that merely holds a `?` (a query id), and other addresses, alone', () => {
    const tree = serializer.parse('/project/github.com/o/r/d/-/query/x');
    const segments = tree.root.children['primary'].segments;
    segments[segments.length - 1] = new UrlSegment('a?b', {});
    expect(liftProjectQuery(tree)).toBe(tree);
    const other = serializer.parse('/store/s/project/p/x');
    expect(liftProjectQuery(other)).toBe(other);
  });
});
