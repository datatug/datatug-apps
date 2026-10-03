import { describe, expect, it } from 'vitest';
import {
  hasOutletGroup,
  pathHasOutletGroup,
  SegmentGroupLike,
} from './outlet-group';

const group = (
  segments: string[],
  children: Record<string, SegmentGroupLike> = {},
  parent?: SegmentGroupLike,
): SegmentGroupLike => {
  const result: SegmentGroupLike = {
    segments,
    children,
    parent,
    hasChildren: () => Object.keys(children).length > 0,
  };
  return result;
};

describe('hasOutletGroup', () => {
  it('is false for no group at all', () => {
    expect(hasOutletGroup(undefined)).toBe(false);
    expect(hasOutletGroup(null)).toBe(false);
  });

  it('is false for a plain path: a primary group with no other group', () => {
    const root = group([]);
    const primary = group(['project', 'github.com', 'o', 'r'], {}, root);
    (root.children as Record<string, SegmentGroupLike>)['primary'] = primary;
    expect(hasOutletGroup(primary)).toBe(false);
  });

  it('is true for a group below the path, `…/a(b)`', () => {
    const below = group(['b']);
    const primary = group(['project', 'a'], { primary: below });
    expect(hasOutletGroup(primary)).toBe(true);
  });

  it('is true for a named group beside the path, `…/chat(menu:x)`', () => {
    const root = group([]);
    const primary = group(['project', 'chat'], {}, root);
    const menu = group(['x'], {}, root);
    (root.children as Record<string, SegmentGroupLike>)['primary'] = primary;
    (root.children as Record<string, SegmentGroupLike>)['menu'] = menu;
    expect(hasOutletGroup(primary)).toBe(true);
  });

  it('is false for an empty named group, which the router adds for an outlet whose route has an empty path', () => {
    const root = group([]);
    const primary = group(['project', 'chat'], {}, root);
    const menu = group([], {}, root);
    (root.children as Record<string, SegmentGroupLike>)['primary'] = primary;
    (root.children as Record<string, SegmentGroupLike>)['menu'] = menu;
    expect(hasOutletGroup(primary)).toBe(false);
  });
});

describe('pathHasOutletGroup', () => {
  it.each([
    '/demo(menu:x)',
    '/demo/(menu:x)',
    '/project/github.com/o/r/chat(menu:x)',
    '/project/github.com/o/r/tree/HEAD/a(b)/-/queries',
    '/demo(',
    '/(demo//menu:x)',
    '/(project/github.com/o/r/chat//menu:x)',
  ])('%s has one', (path) => {
    expect(pathHasOutletGroup(path)).toBe(true);
  });

  it.each([
    '/',
    '/demo',
    '/project/github.com/o/r/tree/HEAD/a%28b%29/-/queries',
    '/(demo)',
    '/(demo)/',
    '/(project/github.com/o/r/chat)',
    '/(Demo;x=1)',
    '//project/github.com/o/r/chat',
  ])('%s has none', (path) => {
    expect(pathHasOutletGroup(path)).toBe(false);
  });
});
