import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoardWidgetComponent } from './board-widget.component';

describe('BoardWidgetComponent', () => {
  let component: BoardWidgetComponent;
  let fixture: ComponentFixture<BoardWidgetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(BoardWidgetComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardWidgetComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('links a SQL card to its folder-qualified saved query in the same project', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/chinook-top-customer-spend' } },
    });
    fixture.detectChanges();

    expect(component.queryHref()).toBe(
      '/project/github.com/o/r/tree/v1.0.0/-/query/demodb%2Fchinook-top-customer-spend',
    );
    expect(component.queryParams()).toEqual({
      id: 'demodb/chinook-top-customer-spend',
    });
  });

  it('keeps the authenticated project transport when opening a saved query', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@feature',
      projectApi: 'cloud',
      branch: 'feature',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/q' } },
    });
    fixture.detectChanges();

    expect(component.queryParams()).toEqual({
      id: 'demodb/q',
      projectApi: 'cloud',
      branch: 'feature',
    });
  });
});
