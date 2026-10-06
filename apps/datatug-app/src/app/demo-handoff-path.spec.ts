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
  // review r2: other spellings of the same path, which the router's parser reads as the same address
  '//demo',
  '///demo',
  '//demo/',
  '/(demo)',
  '/(demo)/',
  '/(Demo;x=1)',
  '/(demo//menu:x)',
  '/(demo)(menu:x)',
  '/(demo/other)',
  '/demo//other',
  '/demo///',
  '//project/github.com/o/r/chat',
  '///project/github.com/o/r/chat',
  '/(project/github.com/o/r/chat)',
  '/(project/github.com/o/r/tree/abc123/-/chat)',
  '/(project/github.com/o/r/tree/abc123/-/chat//menu:x)',
  '//project/github.com/o/r/tree/abc123/-/chat',
  '/project//github.com/o/r/chat',
  '/project/github.com/o/r//chat',
  '/project/github.com/o/r/chat//',
  '/project/github.com/o/r/chat(menu:x)/',
  '/project/github.com/o/r/tree/HEAD/a(b)/-/chat',
  // the confirmation page (founder ruling 2026-10-03): `start-chat`, with a folder or a ref
  '/project/github.com/datatug/chinook-demo/start-chat',
  '/project/github.com/datatug/chinook-demo/start-chat/',
  '/project/github.com/datatug/chinook-demo/start-chat;x=1',
  '/Project/GitHub.com/O/R/Start-Chat',
  '/project/github.com/o/r/tree/abc123/-/start-chat',
  '/project/github.com/o/r/tree/HEAD/dir/-/start-chat',
  '/project/github.com/o/r/tree/abc123/a/b/-/start-chat',
  '/project/github.com/o/r/tree/abc123/a/-/b/-/start-chat',
  '/project/github.com/o/r/tree/abc123/start-chat',
  '/project/github.com/o/r/tree/-/start-chat',
  '/project/github.com/o/r/tree/abc123//-/start-chat',
  '/project/github.com/o/r/start-chat/extra',
  '/project/github.com/o/start-chat',
  '/project/gitlab.com/o/r/start-chat',
  '/start-chat',
  '//project/github.com/o/r/start-chat',
  '/(project/github.com/o/r/start-chat)',
  '/(project/github.com/o/r/tree/HEAD/d/-/start-chat)',
  '/project/github.com/o/r/start-chat(menu:x)',
  '/project/github.com/o/r/tree/HEAD/a(b)/-/start-chat',
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
      // review r2: how the router's parser reads these (index.html's script does the same)
      ['//demo', ['demo']],
      ['///demo/', ['demo']],
      ['/(demo)', ['demo']],
      [
        '/(project/github.com/o/r/chat)',
        ['project', 'github.com', 'o', 'r', 'chat'],
      ],
      ['/(/project)', ['project']],
      ['/(demo)/', ['demo']],
      ['/(demo)(menu:x)', ['demo']],
      ['/project//github.com/o/r/chat', ['project']],
      ['/a/b//c/d', ['a', 'b']],
      ['/(a;x=1/B%20c)', ['a', 'B c']],
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
    it.each([
      '/(demo//menu:x)',
      '/(project/github.com/o/r/chat//menu:x)',
      '/project/github.com/o/r/tree/HEAD/a(b)/-/chat',
    ])('%s', (path) => {
      expect(isHandoffPath(path)).toBe(false);
    });
    it('and an encoded parenthesis is just a character of a segment', () => {
      expect(isHandoffPath('/project/github.com/a%28b/r/chat')).toBe(true);
    });
  });

  describe('a path written another way that the router reads as a hand-off address is one (review r2)', () => {
    it.each([
      ['//demo', { kind: 'demo' }],
      ['///demo', { kind: 'demo' }],
      ['/(demo)', { kind: 'demo' }],
      ['/(Demo;x=1)/', { kind: 'demo' }],
      [
        '//project/github.com/datatug/chinook-demo/chat',
        {
          kind: 'chat',
          owner: 'datatug',
          repo: 'chinook-demo',
          ref: undefined,
          dir: [],
        },
      ],
      [
        '/(project/github.com/acme/demo/chat)',
        { kind: 'chat', owner: 'acme', repo: 'demo', ref: undefined, dir: [] },
      ],
      [
        '/(project/github.com/acme/demo/tree/HEAD/-/chat)',
        { kind: 'chat', owner: 'acme', repo: 'demo', ref: 'HEAD', dir: [] },
      ],
      [
        '///project/github.com/acme/demo/tree/HEAD/-/chat/',
        { kind: 'chat', owner: 'acme', repo: 'demo', ref: 'HEAD', dir: [] },
      ],
      [
        '//project/github.com/acme/demo/start-chat',
        { kind: 'start-chat', owner: 'acme', repo: 'demo', ref: undefined, dir: [] },
      ],
      [
        '/(project/github.com/acme/demo/tree/HEAD/d/-/start-chat)/',
        { kind: 'start-chat', owner: 'acme', repo: 'demo', ref: 'HEAD', dir: ['d'] },
      ],
    ])('%s', (path, target) => {
      expect(handoffTargetOfPath(path)).toEqual(target);
    });
  });

  describe('handoffTarget', () => {
    it('reads the demo address, the chat address and the tree chat address', () => {
      expect(handoffTarget(['demo'])).toEqual({ kind: 'demo' });
      expect(
        handoffTarget(['project', 'github.com', 'o', 'r', 'chat']),
      ).toEqual({ kind: 'chat', owner: 'o', repo: 'r', ref: undefined, dir: [] });
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
      ).toEqual({ kind: 'chat', owner: 'O', repo: 'R', ref: 'Ab', dir: [] });
    });
    it('reads the start-chat address, at the root, on a ref, and in a folder', () => {
      expect(
        handoffTarget(['project', 'github.com', 'o', 'r', 'start-chat']),
      ).toEqual({ kind: 'start-chat', owner: 'o', repo: 'r', ref: undefined, dir: [] });
      expect(
        handoffTarget([
          'Project',
          'GitHub.com',
          'O',
          'R',
          'tree',
          'Ab',
          '-',
          'START-CHAT',
        ]),
      ).toEqual({ kind: 'start-chat', owner: 'O', repo: 'R', ref: 'Ab', dir: [] });
      expect(
        handoffTarget([
          'project',
          'github.com',
          'o',
          'r',
          'tree',
          'HEAD',
          'a',
          'B',
          '-',
          'start-chat',
        ]),
      ).toEqual({ kind: 'start-chat', owner: 'o', repo: 'r', ref: 'HEAD', dir: ['a', 'B'] });
    });
    it('a nested chat address retains its project folder', () => {
      expect(
        handoffTarget(['project', 'github.com', 'o', 'r', 'tree', 'x', 'd', '-', 'chat']),
      ).toEqual({ kind: 'chat', owner: 'o', repo: 'r', ref: 'x', dir: ['d'] });
    });
    it.each([
      [[]],
      [['project', 'github.com', 'o', 'r', 'start-chat', 'x']],
      [['project', 'github.com', 'o', 'r', 'tree', 'x', 'start-chat']],
      [['project', 'github.com', 'o', 'r', 'tree', '', '-', 'start-chat']],
      [['project', 'github.com', 'o', 'r', 'tree', '-', 'start-chat']],
      [['project', 'github.com', 'o', 'r', 'tree', 'x', 'a', '-', 'b', '-', 'start-chat']],
      [['project', 'github.com', '', 'r', 'start-chat']],
      [['project', 'github.com', 'o', '', 'start-chat']],
      [['project', 'gitlab.com', 'o', 'r', 'start-chat']],
      [['start-chat']],
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
