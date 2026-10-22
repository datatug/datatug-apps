import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router, UrlSegment } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { savedQueryIsMissing } from './project-query-exists.guard';

const GITHUB_PATH =
  '/project/github.com/datatug/demo/tree/HEAD/demo-project-1/-/query/does/not-exist';

describe('savedQueryIsMissing', () => {
  function run(options: {
    url: string;
    state?: unknown;
    hasQuery?: Observable<boolean>;
  }): Promise<boolean> {
    const tree = new DefaultUrlSerializer().parse(options.url);
    const hasQuery = vi.fn(() => options.hasQuery ?? of(false));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            getCurrentNavigation: () => ({
              extractedUrl: tree,
              extras: { state: options.state },
            }),
          },
        },
        { provide: GithubProjectReaderService, useValue: { hasQuery } },
      ],
    });
    const segments = [
      new UrlSegment('query', {}),
      new UrlSegment('does', {}),
      new UrlSegment('not-exist', {}),
    ];
    return TestBed.runInInjectionContext(
      () => savedQueryIsMissing({} as never, segments) as Promise<boolean>,
    );
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('is true for a cold GitHub project address whose tree has no such query', async () => {
    expect(await run({ url: GITHUB_PATH })).toBe(true);
  });

  it('falls through (false) when the query exists', async () => {
    expect(await run({ url: GITHUB_PATH, hasQuery: of(true) })).toBe(false);
  });

  it('falls through when the tree could not be read (rate limit, outage)', async () => {
    expect(
      await run({
        url: GITHUB_PATH,
        hasQuery: throwError(() => new Error('rate limited')),
      }),
    ).toBe(false);
  });

  it('falls through for an in-app navigation that carries state', async () => {
    expect(await run({ url: GITHUB_PATH, state: { action: 'create' } })).toBe(
      false,
    );
  });

  it('falls through for a draft or result editor address', async () => {
    expect(await run({ url: `${GITHUB_PATH}?draft=1` })).toBe(false);
    TestBed.resetTestingModule();
    expect(await run({ url: `${GITHUB_PATH}?result=abc` })).toBe(false);
  });

  it('falls through for a store that is not a short GitHub address', async () => {
    expect(await run({ url: '/project/localhost:8989/demo/-/query/x' })).toBe(
      false,
    );
  });
});
