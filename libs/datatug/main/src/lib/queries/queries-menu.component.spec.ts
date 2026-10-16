import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { QueriesMenuComponent } from './queries-menu.component';
import { ProjectContextService } from '../services/project/project-context.service';
import { QueriesUiService } from './queries-ui.service';
import { QueryEditorStateService } from './query-editor-state-service';

describe('QueriesMenuComponent live sidebar actions', () => {
  it('offers active queries and a qualified catalog link without placeholder tabs', async () => {
    const ref = { storeId: 'localhost:8989', projectId: 'project-a' };
    const closeQuery = vi.fn();
    const setCurrentQuery = vi.fn();
    const openNewQuery = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    );
    await TestBed.configureTestingModule({
      imports: [QueriesMenuComponent],
      providers: [
        provideRouter([]),
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectContextService,
          useValue: { current: ref, current$: of(ref) },
        },
        { provide: QueriesUiService, useValue: { openNewQuery } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of({
              currentQueryId: 'q1',
              activeQueries: [
                { id: 'q1', title: 'Customer inventory', queryType: 'sql' },
              ],
            }),
            setCurrentQuery,
            closeQuery,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(QueriesMenuComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.outerHTML).toContain('Active queries');
    expect(host.outerHTML).toContain('Customer inventory');
    expect(host.outerHTML).toContain('Browse saved queries');
    expect(host.outerHTML).not.toContain('Not implemented yet');
    expect(host.outerHTML).not.toContain('Bookmarked');
    expect(host.querySelector('ion-input')).toBeNull();
    expect(host.querySelector('ion-segment')).toBeNull();

    const catalog = [...host.querySelectorAll('ion-item')].find((item) =>
      item.outerHTML.includes('Browse saved queries'),
    );
    expect(catalog).toBeTruthy();
    expect(catalog?.getAttribute('href')).toBe(
      '/store/localhost:8989/project/project-a/queries',
    );
    const newQuery = [...host.querySelectorAll('ion-item')].find((item) =>
      item.outerHTML.includes('New query'),
    );
    newQuery?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openNewQuery).toHaveBeenCalledWith(ref);

    const row = [...host.querySelectorAll('ion-item')].find((item) =>
      item.outerHTML.includes('Customer inventory'),
    );
    const close = row?.querySelector('ion-button[title="Close query"]');
    expect(close).toBeTruthy();
    close?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closeQuery).toHaveBeenCalledOnce();
    expect(setCurrentQuery).not.toHaveBeenCalled();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(setCurrentQuery).toHaveBeenCalledWith('q1');
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
