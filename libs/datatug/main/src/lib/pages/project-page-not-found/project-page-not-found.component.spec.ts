import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { datatugProjectRoutes } from '../../routes/datatug-routing-proj';
import { ProjectPageNotFoundComponent } from './project-page-not-found.component';

@Component({ template: 'overview' })
class OverviewStubComponent {}

describe('unknown project page addresses', () => {
  it('ends the project routes with a catch-all that loads the not-found page', async () => {
    const last = datatugProjectRoutes[datatugProjectRoutes.length - 1];
    expect(last.path).toBe('**');
    const loaded = await last.loadComponent?.();
    expect(loaded).toBe(ProjectPageNotFoundComponent);
  });

  it('shows a not-found page for -/dbmodels instead of failing to match (NG04002)', async () => {
    const catchAll = datatugProjectRoutes[datatugProjectRoutes.length - 1];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'p',
            children: [
              { path: 'overview', component: OverviewStubComponent },
              catchAll,
            ],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/p/dbmodels');
    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain('This project has no “dbmodels” page');

    const link = harness.routeNativeElement?.querySelector(
      'a[data-testid="project-not-found-overview"]',
    ) as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('/p/overview');
    link?.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/p/overview');
  });

  it('names a multi-segment address in full', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'p', children: [datatugProjectRoutes[datatugProjectRoutes.length - 1]] },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/p/dbmodel/chinook');
    expect(harness.routeNativeElement?.textContent).toContain(
      'This project has no “dbmodel/chinook” page',
    );
  });
});
