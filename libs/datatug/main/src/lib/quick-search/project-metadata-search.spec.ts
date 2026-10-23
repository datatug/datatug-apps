import { HttpErrorResponse } from '@angular/common/http';
import {
  MetadataItem,
  fromSearchDocument,
  groupMatches,
  highlightParts,
  matchMetadata,
  matchSecondary,
  secondaryLines,
  quickSearchErrorMessage,
} from './project-metadata-search';
import { GITHUB_RATE_LIMIT_MESSAGE } from '../services/repo/github/github-read-limits';
import { IProjectRef } from '../core/project-context';

const item = (
  kind: MetadataItem['kind'],
  title: string,
  extra: Partial<MetadataItem> = {},
): MetadataItem => ({ kind, id: title, title, tags: [], ...extra });

describe('matchMetadata', () => {
  const items = [
    item('query', 'Top customers by revenue', { id: 'customers/top' }),
    item('table', 'Customer', { context: 'chinook · main' }),
    item('column', 'CustomerId', { context: 'Invoice · chinook' }),
    item('board', 'Sales overview', { tags: ['CUSTOMER-facing'] }),
    item('entity', 'Album', { description: 'Music customer purchases' }),
    item('query', 'Invoices', { id: 'sales/invoices' }),
  ];

  it('matches a case-insensitive substring of titles, ids, tags and descriptions', () => {
    const matched = matchMetadata(items, 'CUSTOMER').map((m) => [
      m.item.title,
      m.field,
    ]);
    expect(matched).toEqual(
      expect.arrayContaining([
        ['Top customers by revenue', 'title'],
        ['Customer', 'title'],
        ['CustomerId', 'title'],
        ['Sales overview', 'tag'],
        ['Album', 'description'],
      ]),
    );
    expect(matched).toHaveLength(5);
  });

  it('ranks a title prefix before a contained title, then tags, then descriptions', () => {
    expect(matchMetadata(items, 'customer').map((m) => m.item.title)).toEqual([
      'Customer',
      'CustomerId',
      'Top customers by revenue',
      'Sales overview',
      'Album',
    ]);
  });

  it('matches the last ID segment, not where an item lives, and nothing for a blank query', () => {
    expect(matchMetadata(items, 'invoices')[0].item.id).toBe('sales/invoices');
    expect(matchMetadata(items, 'sales/inv')).toEqual([]);
    expect(matchMetadata(items, 'chinook')).toEqual([]);
    expect(matchMetadata(items, '   ')).toEqual([]);
  });

  it('describes why a non-title match matched', () => {
    const [tag] = matchMetadata(items, 'facing');
    expect(matchSecondary(tag)).toBe('Board · Tag: CUSTOMER-facing');
    const [column] = matchMetadata(items, 'CustomerId');
    expect(matchSecondary(column)).toBe('Column · Invoice · chinook');
  });
});

describe('groupMatches', () => {
  const many = [
    ...Array.from({ length: 8 }, (_, i) => item('table', `Customer${i}`)),
    item('tag', 'customer'),
    ...Array.from({ length: 3 }, (_, i) => item('query', `customer q${i}`)),
  ];
  it('groups in a fixed type order and caps each group while keeping its total', () => {
    const groups = groupMatches(matchMetadata(many, 'customer'), 5);
    expect(groups.map((g) => [g.title, g.total, g.matches.length])).toEqual([
      ['Queries', 3, 3],
      ['Tables', 8, 5],
      ['Tags', 1, 1],
    ]);
    expect(groups[1].icon).toBe('grid-outline');
  });
  it('shows everything without a limit and omits empty groups', () => {
    const groups = groupMatches(matchMetadata(many, 'q1'));
    expect(groups).toHaveLength(1);
    expect(groups[0].matches).toHaveLength(1);
  });
});

describe('highlightParts', () => {
  it('marks every case-insensitive occurrence', () => {
    expect(highlightParts('Customer customers', 'CUSTOMER')).toEqual([
      { text: 'Customer', hit: true },
      { text: ' ', hit: false },
      { text: 'customer', hit: true },
      { text: 's', hit: false },
    ]);
  });
  it('leaves text unmarked for an empty query', () => {
    expect(highlightParts('Album', '')).toEqual([
      { text: 'Album', hit: false },
    ]);
  });
});

describe('quickSearchErrorMessage', () => {
  const safe = (text: string) => {
    expect(text).not.toMatch(/https?:|\?|undefined|token|stack/i);
    return text;
  };

  it('words a GitHub 403 rate limit as a rate limit, never as missing project access', () => {
    const http403 = new HttpErrorResponse({
      status: 403,
      url: 'https://api.github.com/repos/datatug/datatug-demo-project/commits/HEAD?x=1',
      error: { message: 'API rate limit exceeded for 1.2.3.4.' },
    });
    for (const error of [
      http403,
      new Error(GITHUB_RATE_LIMIT_MESSAGE),
      { kind: 'refused' },
    ]) {
      const text = safe(quickSearchErrorMessage(error));
      expect(text).toContain('GitHub is limiting');
      expect(text).not.toMatch(/access/i);
    }
  });

  it('maps hosted Quick Search error codes to honest words', () => {
    const hosted = (status: number, code: string) =>
      new HttpErrorResponse({
        status,
        url: 'https://api.sneat.cloud/v0/datatug/project/quick-search/search?storage=github.com&project=p',
        error: { error: { code } },
      });
    expect(
      safe(quickSearchErrorMessage(hosted(409, 'consent_required'))),
    ).toContain('not enabled');
    expect(
      safe(
        quickSearchErrorMessage(hosted(409, 'quick_search_reindex_required')),
      ),
    ).toContain('out of date');
    expect(
      safe(quickSearchErrorMessage(hosted(503, 'search_unavailable'))),
    ).toContain('temporarily unavailable');
    expect(
      safe(quickSearchErrorMessage(hosted(429, 'quick_search_rate_limited'))),
    ).toContain('Too many searches');
    expect(
      safe(quickSearchErrorMessage(hosted(403, 'project_denied'))),
    ).toContain('cannot search');
  });

  it('words an expired sign-in and other failures without raw details', () => {
    expect(
      safe(
        quickSearchErrorMessage(
          new HttpErrorResponse({
            status: 401,
            url: 'https://api.sneat.cloud/v0/x?token=abc',
          }),
        ),
      ),
    ).toContain('Sign in to search this project');
    expect(
      quickSearchErrorMessage(
        new HttpErrorResponse({ status: 401 }),
        undefined,
        { signedIn: true },
      ),
    ).toContain('sign-in has expired');
    expect(
      safe(quickSearchErrorMessage(new Error('boom at https://x.test/a?b=c'))),
    ).toBe('Some project metadata could not be read. Try again.');
  });
});

describe('fromSearchDocument', () => {
  const ref: IProjectRef = {
    storeId: 'github.com',
    projectId: 'datatug-demo-project@datatug@demo-project-1',
  };
  it('maps hosted documents onto local kinds with closed routes', () => {
    const view = fromSearchDocument(ref, {
      kind: 'view',
      id: 'm/main/view/V',
      name: 'V',
      sourceName: 'chinook',
      tags: [],
      reference: { dbModelId: 'm', schema: 'main', table: 'V' },
    });
    expect(view).toMatchObject({
      kind: 'table',
      icon: 'eye-outline',
      title: 'V',
    });
    expect(view?.href).toContain('/search-schema/m');
    expect(
      fromSearchDocument(ref, {
        kind: 'server',
        id: 's',
        name: 's',
        tags: [],
        reference: {},
      }),
    ).toBeUndefined();
  });
});

describe('secondaryLines', () => {
  it('adds the ID only when two results in a group read the same', () => {
    const matches = matchMetadata(
      [
        item('query', 'Top Customer Spend', {
          id: 'demodb/a',
          context: 'demodb',
        }),
        item('query', 'Top Customer Spend', {
          id: 'demodb/b',
          context: 'demodb',
        }),
        item('query', 'Customer invoices', { id: 'c', context: 'customers' }),
      ],
      'customer',
    );
    expect(secondaryLines(matches)).toEqual([
      'Query · customers',
      'Query · demodb · ID: demodb/a',
      'Query · demodb · ID: demodb/b',
    ]);
  });
});
