import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DefaultUrlSerializer,
  provideRouter,
  Router,
  UrlSegment,
  UrlSegmentGroup,
} from '@angular/router';
import {
  handoffTarget,
  handoffTargetOfPath,
  handoffUrlMatcher,
  isHandoffPath,
  routeSegments,
} from './demo-handoff-path';

@Component({ selector: 'sneat-stub-handoff', template: '' })
class HandoffStub {}
@Component({ selector: 'sneat-stub-other', template: '' })
class OtherStub {}

// Every address here is a router URL (path only); `?q=1` is added by the tests that need a query.
const ADDRESSES = [
  '/demo',
  '/demo/',
  '/Demo',
  '/DEMO/',
  '/dEmO',
  '/demo;x=1',
  '/demo;x=1/',
  '/demo;a=1;b=2',
  '/%64emo',
  '/demos',
  '/demo/other',
  '/demo;x=1/other',
  '/demo//',
  '/',
  '/chat',
  '/store/github.com/project/p/chat',
  '/project/github.com/datatug/chinook-demo/chat',
  '/project/github.com/datatug/chinook-demo/chat/',
  '/project/github.com/datatug/chinook-demo/chat;x=1',
  '/project/github.com;x=1/o;y=2/r/chat',
  '/Project/GitHub.com/O/R/Chat',
  '/PROJECT/GITHUB.COM/o/r/TREE/abc/-/CHAT',
  '/project/github.com/o/r/tree/abc123/-/chat',
  '/project/github.com/o/r/tree;a=1/abc123/-;b=2/chat',
  '/project/github.com/o%2Fx/r/chat',
  '/project/github.com/o/r',
  '/project/github.com/o/r/chat/extra',
  '/project/github.com/o/chat',
  '/project/gitlab.com/o/r/chat',
  '/project/github.com/o/r/tree/abc123/chat',
  '/project/github.com/o/r/tree/abc123/dir/-/chat',
  '/project/github.com/o/r/tree/-/chat',
  '/demo(menu:x)',
  '/demo/(menu:x)',
  '/Demo(menu:x/y)',
  '/project/github.com/o/r/chat(menu:x)',
];

// A browser address reaches the router through Angular's Location, which drops one trailing slash before the
// router parses it (so `/demo/` is `/demo`, and `/demo//` is `/demo/`, which does not match). The router tests
// below do the same, since `navigateByUrl` and the serializer alone do not.
const asTheRouterSeesIt = (path: string): string =>
  path.replace(/\/?([?#]|$)/, '$1'); // the same expression as Angular's Location

describe('demo-handoff-path', () => {
  describe('routeSegments', () => {
    it.each([
      ['/', []],
      ['', []],
      ['/demo', ['demo']],
      ['/demo/', ['demo']],
      ['/demo;x=1', ['demo']],
      ['/a/b;c=d/e%20f', ['a', 'b', 'e f']],
      ['/%E0%A4%A', ['%E0%A4%A']],
      ['/demo//', ['demo', '']],
    ])('%j is %j', (pathname, expected) => {
      expect(routeSegments(pathname)).toEqual(expected);
    });
  });

  describe('an address with an auxiliary-outlet group is not a hand-off address', () => {
    it.each([
      '/demo(menu:x)',
      '/demo/(menu:x)',
      '/Demo(menu:x/y)',
      '/project/github.com/o/r/chat(menu:x)',
      '/demo(',
    ])('%s', (path) => {
      expect(isHandoffPath(path)).toBe(false);
      expect(handoffTargetOfPath(path)).toBeUndefined();
    });
    it('while the same address without the group is one', () => {
      expect(isHandoffPath('/demo')).toBe(true);
      expect(handoffTargetOfPath('/demo')).toEqual({ kind: 'demo' });
    });
    it('and an encoded parenthesis is just a character of a segment', () => {
      expect(isHandoffPath('/project/github.com/a%28b/r/chat')).toBe(true);
    });
  });

  describe('handoffTarget', () => {
    it('reads the demo address, the chat address and the tree chat address', () => {
      expect(handoffTarget(['demo'])).toEqual({ kind: 'demo' });
      expect(
        handoffTarget(['project', 'github.com', 'o', 'r', 'chat']),
      ).toEqual({ kind: 'chat', owner: 'o', repo: 'r', ref: undefined });
      expect(
        handoffTarget([
          'Project',
          'GitHub.com',
          'O',
          'R',
          'tree',
          'Ab',
          '-',
          'CHAT',
        ]),
      ).toEqual({ kind: 'chat', owner: 'O', repo: 'R', ref: 'Ab' });
    });
    it.each([
      [[]],
      [['demo', 'x']],
      [['project']],
      [['project', 'github.com', 'o', 'r']],
      [['project', 'github.com', '', 'r', 'chat']],
      [['project', 'github.com', 'o', '', 'chat']],
      [['project', 'github.com', 'o', 'r', 'tree', '', '-', 'chat']],
      [['project', 'github.com', 'o', 'r', 'tree', 'x', 'y', 'chat']],
      [['project', 'gitlab.com', 'o', 'r', 'chat']],
    ])('%j is not a hand-off', (segments) => {
      expect(handoffTarget(segments)).toBeUndefined();
    });
  });

  describe('agreement with the router', () => {
    const serializer = new DefaultUrlSerializer();

    it.each(ADDRESSES)(
      'the matcher accepts %s exactly when isHandoffPath does (on the segments the router parsed)',
      (path) => {
        let group: UrlSegmentGroup | undefined;
        try {
          group = serializer.parse(asTheRouterSeesIt(path)).root.children[
            'primary'
          ];
        } catch {
          group = undefined;
        }
        // The router hands the matcher the primary group's segments and the group itself.
        const matched =
          !!group &&
          handoffUrlMatcher(group.segments, group, null as never) !== null;
        expect(matched, path).toBe(isHandoffPath(path));
      },
    );

    it('the matcher consumes every segment or none', () => {
      const segments = [new UrlSegment('demo', {})];
      expect(handoffUrlMatcher(segments, null as never, null as never)).toEqual(
        {
          consumed: segments,
        },
      );
      expect(
        handoffUrlMatcher(
          [new UrlSegment('demo', {}), new UrlSegment('x', {})],
          null as never,
          null as never,
        ),
      ).toBeNull();
    });

    it.each(ADDRESSES)(
      'the real router lands on the hand-off route for %s exactly when isHandoffPath says so',
      async (path) => {
        TestBed.configureTestingModule({
          providers: [
            provideRouter([
              { matcher: handoffUrlMatcher, component: HandoffStub },
              // The app shell's side menu: a named outlet with an empty path, which the router adds an empty group for.
              { path: '', outlet: 'menu', component: OtherStub },
              { path: '**', component: OtherStub },
            ]),
          ],
        });
        const router = TestBed.inject(Router);
        let landed: unknown;
        try {
          await router.navigateByUrl(asTheRouterSeesIt(path) + '?q=1');
          landed = router.routerState.snapshot.root.firstChild?.component;
        } catch {
          landed = undefined; // the router itself refused the address
        }
        expect(landed === HandoffStub, path).toBe(isHandoffPath(path));
      },
    );
  });
});
