import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterLink } from '@angular/router';

import { BoardWidgetComponent } from './board-widget.component';

describe('BoardWidgetComponent', () => {
  let fixture: ComponentFixture<BoardWidgetComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardWidgetComponent],
      providers: [provideRouter([])],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(BoardWidgetComponent);
  });

  function renderedQueryLink(): string {
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.directive(RouterLink));
    expect(button).not.toBeNull();
    expect(button.nativeElement.textContent).toContain('Open saved query');
    const urlTree = button.injector.get(RouterLink).urlTree;
    if (!urlTree) throw new Error('Expected a saved-query RouterLink URL');
    return router.serializeUrl(urlTree);
  }

  it('renders a working anonymous demo query link', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o@@v1.0.0',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/chinook-top-customer-spend' } },
    });

    expect(renderedQueryLink()).toBe(
      '/project/github.com/o/r/tree/v1.0.0/-/query/demodb%2Fchinook-top-customer-spend?id=demodb%2Fchinook-top-customer-spend',
    );
  });

  it('preserves the cloud transport and branch in the actual router link', () => {
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

    expect(renderedQueryLink()).toBe(
      '/project/github.com/o/r/tree/feature/-/query/demodb%2Fq?projectApi=cloud&branch=feature&id=demodb%2Fq',
    );
  });

  it('shows unavailable text instead of a dead link when the query is absent', () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'r@o',
    });
    fixture.componentRef.setInput('widgetDef', {
      name: 'SQL',
      data: { sql: {} },
    });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(RouterLink))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'This saved query is unavailable.',
    );
  });
});
