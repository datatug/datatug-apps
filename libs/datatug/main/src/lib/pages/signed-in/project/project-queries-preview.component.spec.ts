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
    expect(nested.getAttribute('href')).toContain('sales%2Finvoices');
    expect(nested.textContent).toContain('Invoice totals');
    expect(fixture.nativeElement.innerHTML).toContain('Browse all queries');
    expect(fixture.nativeElement.innerHTML).not.toContain('Run query');
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
