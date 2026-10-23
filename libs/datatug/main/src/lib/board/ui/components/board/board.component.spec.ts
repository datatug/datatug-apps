import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { IonCol } from '@ionic/angular';
import { of } from 'rxjs';
import { QueriesService } from '../../../../queries/queries.service';
import { QueryType } from '../../../../models/definition/query-def';
import { GITHUB_FETCH } from '../../../../services/repo/github/github-project-reader.service';

import { BoardComponent } from './board.component';
import { BoardWidgetComponent } from '../board-widget/board-widget.component';

describe('BoardComponent saved-query journey', () => {
  it('renders a demo board card as a full-width mobile column with an actionable saved query', async () => {
    const getQuery = vi.fn(() =>
      of({
        id: 'chinook-top-customer-spend',
        title: 'Customer spend',
        request: { queryType: QueryType.SQL, text: 'select 1' },
        connectionId: 'chinook-sqlite',
      }),
    );
    const githubFetch = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [
        provideRouter([]),
        { provide: QueriesService, useValue: { getQuery } },
        { provide: GITHUB_FETCH, useValue: githubFetch },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardComponent);
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'chinook@datatug-demo-project@@main',
    });
    fixture.componentRef.setInput('boardDef', {
      id: 'customer-insights',
      rows: [
        {
          cards: [
            {
              id: 'top-customers',
              title: 'Top customers',
              cols: 12,
              widget: {
                name: 'SQL',
                data: {
                  title: 'Customer spend',
                  sql: { queryId: 'demodb/chinook-top-customer-spend' },
                },
              },
            },
          ],
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    try {
      const column = fixture.debugElement.query(By.directive(IonCol));
      expect(column.componentInstance.size).toBe('12');
      expect(column.componentInstance.sizeMd).toBe('12');
      expect(fixture.nativeElement.querySelector('ion-card-title')?.textContent).toContain('Top customers');
      const widget = fixture.debugElement.query(By.directive(BoardWidgetComponent)).componentInstance as BoardWidgetComponent;
      expect(widget.definition()?.title).toBe('Customer spend');
      const link = fixture.debugElement.query(By.directive(RouterLink));
      expect(link).not.toBeNull();
      expect(link.nativeElement.getAttribute('aria-label')).toBe('Edit query');
      const urlTree = link.injector.get(RouterLink).urlTree;
      if (!urlTree) throw new Error('Expected a saved-query RouterLink URL');
      expect(TestBed.inject(Router).serializeUrl(urlTree)).toBe(
        '/project/github.com/datatug-demo-project/chinook/tree/main/-/query/demodb%2Fchinook-top-customer-spend?id=demodb%2Fchinook-top-customer-spend&runtime=project',
      );
      expect(getQuery).toHaveBeenCalledTimes(1);
      expect(getQuery).toHaveBeenCalledWith(
        {
          storeId: 'github.com',
          projectId: 'chinook@datatug-demo-project@@main',
        },
        'demodb/chinook-top-customer-spend',
      );
      expect(githubFetch).not.toHaveBeenCalled();

      const firstWidget = fixture.debugElement.query(By.directive(BoardWidgetComponent),
      ).componentInstance as BoardWidgetComponent;
      firstWidget.runError.set('Held widget state');
      const current = fixture.componentInstance.boardDef();
      const firstCard = current?.rows?.[0]?.cards?.[0];
      if (!current || !firstCard) throw new Error('Expected the first board card');
      fixture.componentRef.setInput('boardDef', {
        ...current,
        rows: [{ ...current.rows?.[0], cards: [firstCard, { id: 'second-card', title: 'Second card' }],
          },
        ],
      });
      fixture.detectChanges();
      await fixture.whenStable();
      const widgets = fixture.debugElement.queryAll(By.directive(BoardWidgetComponent),
      );
      expect(widgets).toHaveLength(2);
      expect(widgets[0].componentInstance).toBe(firstWidget);
      expect(firstWidget.runError()).toBe('Held widget state');
    } finally {
      fixture.destroy();
    }
  });
});
