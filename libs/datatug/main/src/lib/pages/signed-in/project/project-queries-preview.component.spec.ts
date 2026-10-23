import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { QueriesService } from '../../../queries/queries.service';
import {
  ProjectQueriesPreviewComponent,
  countProjectQueries,
} from './project-queries-preview.component';

const ref = {
  storeId: 'github.com',
  projectId: 'datatug-demo-project@datatug@demo-project-1',
};
const query = (id: string, createdAt = '2026-10-21T12:00:00Z') => ({
  id,
  title: id,
  createdAt,
  request: { queryType: 'SQL' },
});

async function create(getQueriesFolder: ReturnType<typeof vi.fn>) {
  await TestBed.configureTestingModule({
    imports: [ProjectQueriesPreviewComponent],
    providers: [
      provideRouter([]),
      { provide: QueriesService, useValue: { getQueriesFolder } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectQueriesPreviewComponent);
  fixture.componentRef.setInput('projectRef', ref);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}
const titles = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-testid^="saved-query-"]')].map((row) =>
    row.textContent?.trim(),
  );
const sort = async (
  fixture: Awaited<ReturnType<typeof create>>,
  value: string,
) => {
  fixture.nativeElement
    .querySelector('ion-segment')
    .dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  await fixture.whenStable();
};
const reverse = async (fixture: Awaited<ReturnType<typeof create>>) => {
  fixture.nativeElement.querySelector('ion-button').click();
  await fixture.whenStable();
};

describe('project query overview', () => {
  it('defaults to creation date descending, supports both directions and both sorting tabs', async () => {
    const fixture = await create(
      vi.fn(() =>
        of({
          id: '~',
          items: [
            query('Alpha', '2026-01-01T00:00:00Z'),
            query('Zulu', '2026-03-01T00:00:00Z'),
            query('Bravo', '2026-02-01T00:00:00Z'),
          ],
        }),
      ),
    );
    expect(titles(fixture.nativeElement)).toEqual(['Zulu', 'Bravo', 'Alpha']);
    expect(fixture.nativeElement.textContent).not.toContain('Project queries');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Reusable requests',
    );
    await reverse(fixture);
    expect(titles(fixture.nativeElement)).toEqual(['Alpha', 'Bravo', 'Zulu']);
    await sort(fixture, 'alphabetical');
    expect(titles(fixture.nativeElement)).toEqual(['Alpha', 'Bravo', 'Zulu']);
    await reverse(fixture);
    expect(titles(fixture.nativeElement)).toEqual(['Zulu', 'Bravo', 'Alpha']);
    expect(
      fixture.nativeElement.querySelectorAll('ion-segment-button ion-icon'),
    ).toHaveLength(2);
  });

  it('starts each sort field in its natural direction: names A→Z, dates newest first', async () => {
    const fixture = await create(
      vi.fn(() =>
        of({
          id: '~',
          items: [
            query('Alpha', '2026-01-01T00:00:00Z'),
            query('Zulu', '2026-03-01T00:00:00Z'),
            query('Bravo', '2026-02-01T00:00:00Z'),
          ],
        }),
      ),
    );
    // Default: Newest first. Switching to names must not carry the descending direction over (Z→A).
    await sort(fixture, 'alphabetical');
    expect(titles(fixture.nativeElement)).toEqual(['Alpha', 'Bravo', 'Zulu']);
    await reverse(fixture);
    expect(titles(fixture.nativeElement)).toEqual(['Zulu', 'Bravo', 'Alpha']);
    // Back to dates: newest first again, not oldest.
    await sort(fixture, 'newest');
    expect(titles(fixture.nativeElement)).toEqual(['Zulu', 'Bravo', 'Alpha']);
    const direction = fixture.nativeElement.querySelector(
      'ion-button.query-sort-direction',
    ) as HTMLElement;
    expect(direction.getAttribute('aria-label')).toBe(
      'Newest first. Reverse sort order',
    );
    expect(
      direction.querySelector('.query-sort-direction-short-label')?.textContent?.trim(),
    ).toBe('Newest');
    const short = [
      ...fixture.nativeElement.querySelectorAll('.query-sort-short-label'),
    ].map((label: Element) => label.textContent?.trim());
    expect(short).toEqual(['Name', 'Date']);
  });

  it('sorts all recursive queries before taking the first 100 and retains exact paths', async () => {
    const items = Array.from({ length: 105 }, (_, i) =>
      query(
        `Query ${String(i).padStart(3, '0')}`,
        new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      ),
    );
    const folder = { id: '~', folders: [{ id: 'nested', items }] };
    const fixture = await create(vi.fn(() => of(folder)));
    expect(countProjectQueries(folder as never)).toBe(105);
    expect(titles(fixture.nativeElement)).toHaveLength(100);
    expect(titles(fixture.nativeElement)[0]).toBe('Query 104');
    expect(titles(fixture.nativeElement)[99]).toBe('Query 005');
    expect(fixture.nativeElement.textContent).toContain(
      'Showing 100 of 105 queries.',
    );
    expect(
      fixture.nativeElement
        .querySelector('a.query-row-main')
        .getAttribute('href'),
    ).toContain('nested%2FQuery%20104');
    await reverse(fixture);
    expect(titles(fixture.nativeElement)[0]).toBe('Query 000');
  });

  it('shows all 59 records without an inner total or heading', async () => {
    const fixture = await create(
      vi.fn(() =>
        of({
          id: '~',
          items: Array.from({ length: 59 }, (_, i) => query(`q-${i}`)),
        }),
      ),
    );
    expect(titles(fixture.nativeElement)).toHaveLength(59);
    expect(fixture.nativeElement.querySelector('ion-card-title')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('View all 59');
  });

  it.each([
    undefined,
    'invalid',
    '2026',
    '1',
    '2026-02-31T12:00:00Z',
    '0001-01-01T00:00:00Z',
  ])(
    'rejects saved queries without valid creation metadata: %s',
    async (createdAt) => {
      const fixture = await create(
        vi.fn(() =>
          of({ id: '~', items: [{ ...query('invalid'), createdAt }] }),
        ),
      );
      expect(
        fixture.nativeElement.querySelector('[role="status"]'),
      ).not.toBeNull();
      expect(titles(fixture.nativeElement)).toHaveLength(0);
    },
  );

  it('reuses the parent query source without issuing a second folder request', async () => {
    const get = vi.fn(() => of({ id: '~', items: [] }));
    const fixture = await create(get);
    get.mockClear();
    fixture.componentRef.setInput(
      'querySource',
      of({ id: '~', items: [query('Shared source')] }),
    );
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      projectId: 'another',
    });
    await fixture.whenStable();
    expect(get).not.toHaveBeenCalled();
    expect(titles(fixture.nativeElement)).toEqual(['Shared source']);
  });

  it('handles empty, error and stale responses without leaking old project rows', async () => {
    const pending = new Subject<unknown>();
    const get = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(of({ id: '~', items: [] }))
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    const fixture = await create(get);
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      projectId: 'second',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    pending.next({ id: '~', items: [query('stale')] });
    await fixture.whenStable();
    expect(fixture.nativeElement.innerHTML).toContain('No shared queries');
    expect(titles(fixture.nativeElement)).toHaveLength(0);
    fixture.componentRef.setInput('projectRef', { ...ref, projectId: 'third' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="status"]'),
    ).not.toBeNull();
  });

  it('heads the card with a Queries link to the full Queries page and filters rows client-side', async () => {
    const fixture = await create(
      vi.fn(() =>
        of({
          id: '~',
          items: [query('Chinook customers'), query('Northwind orders')],
          folders: [{ id: 'sub', items: [query('Chinook invoices')] }],
        }),
      ),
    );
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('.tab-panel-header a');
    expect(link?.textContent?.trim()).toBe('Queries');
    expect(link?.getAttribute('href')).toBe(
      '/project/github.com/datatug/datatug-demo-project/demo-project-1/-/queries',
    );
    el.querySelector('ion-input')?.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: 'chinook' } }),
    );
    await fixture.whenStable();
    expect(titles(el).sort()).toEqual([
      'Chinook customers',
      'Chinook invoices',
    ]);
    el.querySelector('ion-input')?.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: 'nothing-like-this' } }),
    );
    await fixture.whenStable();
    expect(titles(el)).toHaveLength(0);
    expect(el.textContent).toContain('No queries match “nothing-like-this”.');
  });
});
