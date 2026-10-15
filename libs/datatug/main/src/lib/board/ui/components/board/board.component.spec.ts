import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { IonCol } from '@ionic/angular';

import { BoardComponent } from './board.component';

describe('BoardComponent saved-query journey', () => {
  it('renders a demo board card as a full-width mobile column with an actionable saved query', async () => {
    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [provideRouter([])],
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

    const column = fixture.debugElement.query(By.directive(IonCol));
    expect(column.componentInstance.size).toBe('12');
    expect(column.componentInstance.sizeMd).toBe('12');
    expect(fixture.nativeElement.textContent).toContain('Customer spend');
    const link = fixture.debugElement.query(By.directive(RouterLink));
    expect(link).not.toBeNull();
    expect(link.nativeElement.textContent).toContain('Open saved query');
    const urlTree = link.injector.get(RouterLink).urlTree;
    if (!urlTree) throw new Error('Expected a saved-query RouterLink URL');
    expect(TestBed.inject(Router).serializeUrl(urlTree)).toBe(
      '/project/github.com/datatug-demo-project/chinook/tree/main/-/query/demodb%2Fchinook-top-customer-spend?id=demodb%2Fchinook-top-customer-spend',
    );
  });
});
