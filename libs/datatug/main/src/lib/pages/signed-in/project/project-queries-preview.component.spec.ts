import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { QueriesService } from '../../../queries/queries.service';
import { ProjectQueriesPreviewComponent } from './project-queries-preview.component';

const ref = {
  storeId: 'github.com',
  projectId: 'datatug-demo-project@datatug@demo-project-1',
};

describe('project saved-query preview', () => {
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
    fixture.detectChanges();
    return fixture;
  }

  it('shows saved queries from the shared reader and links to their exact detail routes', async () => {
    const getQueriesFolder = vi.fn(() =>
      of({
        id: '~',
        items: [
          { id: 'top', title: 'Top query', request: { queryType: 'SQL' } },
        ],
        folders: [
          {
            id: 'sales',
            items: [
              {
                id: 'invoices',
                title: 'Invoice totals',
                request: { queryType: 'SQL' },
              },
            ],
          },
        ],
      }),
    );
    const fixture = await create(getQueriesFolder);
    expect(getQueriesFolder).toHaveBeenCalledWith(ref, '~', 'shared');
    const nested = fixture.nativeElement.querySelector(
      '[data-testid="saved-query-sales/invoices"]',
    );
    expect(nested).not.toBeNull();
    const row = nested.closest('ion-item');
    expect(row.getAttribute('href')).toContain('sales%2Finvoices');
    expect(row.hasAttribute('button')).toBe(true);
    expect(row.getAttribute('aria-label')).toContain('SQL, open saved query');
    expect(nested.textContent).toContain('Invoice totals');
    expect(fixture.nativeElement.innerHTML).toContain('View all 2 queries');
    expect(fixture.nativeElement.innerHTML).not.toContain('Run query');
  });

  it('keeps branch and connection context in full-row links', async () => {
    const contextualRef = {
      storeId: 'localhost:8989',
      projectId: 'sample',
      projectApi: 'local' as const,
      branch: 'feature/topic',
    };
    const getQueriesFolder = vi.fn(() =>
      of({
        id: '~',
        folders: [
          {
            id: 'sales',
            items: [
              {
                id: 'invoice totals',
                request: { queryType: 'SQL' },
              },
            ],
          },
        ],
      }),
    );
    await TestBed.configureTestingModule({
      imports: [ProjectQueriesPreviewComponent],
      providers: [
        provideRouter([]),
        { provide: QueriesService, useValue: { getQueriesFolder } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectQueriesPreviewComponent);
    fixture.componentRef.setInput('projectRef', contextualRef);
    fixture.detectChanges();
    await fixture.whenStable();
    const row = fixture.nativeElement.querySelector('ion-item[button]');
    const link = new URL(row.getAttribute('href'), 'https://datatug.test');
    expect(decodeURIComponent(link.pathname)).toContain('query/sales/invoice totals');
    expect(link.searchParams.get('id')).toBe('sales/invoice totals');
    expect(link.searchParams.get('projectApi')).toBe('local');
    expect(link.searchParams.get('branch')).toBe('feature/topic');
  });

  it('explains a genuinely empty project and a failed load', async () => {
    const getQueriesFolder = vi.fn(() =>
      of({ id: '~', items: [], folders: [] }),
    );
    const fixture = await create(getQueriesFolder);
    expect(fixture.nativeElement.innerHTML).toContain(
      'No shared queries saved in this project yet',
    );
    getQueriesFolder.mockImplementation(() =>
      throwError(() => new Error('offline')),
    );
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      projectId: 'another',
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.innerHTML,
    ).toContain('could not be loaded');
  });

  it('drops a stale project response after the project changes', async () => {
    const pending = new Subject<unknown>();
    const getQueriesFolder = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(of({ id: '~', items: [], folders: [] }));
    const fixture = await create(getQueriesFolder);
    fixture.componentRef.setInput('projectRef', {
      ...ref,
      projectId: 'second',
    });
    fixture.detectChanges();
    pending.next({
      id: '~',
      items: [{ id: 'stale', request: { queryType: 'SQL' } }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain(
      'No shared queries saved in this project yet',
    );
    expect(fixture.nativeElement.textContent).not.toContain('stale');
  });
});
