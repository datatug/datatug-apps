import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { SneatDatatugPageTitleComponent } from './sneat-datatug-page-title.component';
import { IProjectContext } from '../../nav/nav-models';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';

function createFixture(
  currentProject$: ReturnType<typeof of<IProjectContext | undefined>> | Subject<IProjectContext | undefined>,
): ComponentFixture<SneatDatatugPageTitleComponent> {
  return TestBed.configureTestingModule({
    imports: [SneatDatatugPageTitleComponent],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [
      {
        provide: DatatugNavContextService,
        useValue: { currentProject: currentProject$ },
      },
    ],
  }).createComponent(SneatDatatugPageTitleComponent);
}

describe('SneatDatatugPageTitleComponent', () => {
  it('renders just the bare page title when there is no project in context', () => {
    const fixture = createFixture(of(undefined));
    fixture.componentRef.setInput('pageTitle', 'Boards');
    fixture.detectChanges();

    const strong = fixture.nativeElement.querySelector('strong');
    expect(strong?.textContent?.trim()).toBe('Boards');
    expect(fixture.nativeElement.textContent).not.toContain('@');
  });

  // Founder ruling 2026-09-10 (S152), example given for the Boards page:
  // "Boards @ DataTug Demo Project 1" — page title bold, project title
  // normal weight.
  it('renders "{Page title} @ {Project title}" once brief.title is populated', () => {
    const project: IProjectContext = {
      ref: { projectId: 'demo-project-1', storeId: 'github.com' },
      brief: { title: 'DataTug Demo Project 1' },
    };
    const fixture = createFixture(of(project));
    fixture.componentRef.setInput('pageTitle', 'Boards');
    fixture.detectChanges();

    const strong = fixture.nativeElement.querySelector('strong');
    expect(strong?.textContent?.trim()).toBe('Boards');
    expect(fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Boards @ DataTug Demo Project 1',
    );
  });

  it('falls back to summary.title when brief.title is missing', () => {
    const project: IProjectContext = {
      ref: { projectId: 'demo-project-1', storeId: 'github.com' },
      summary: {
        id: 'demo-project-1',
        title: 'DataTug Demo Project 1',
        access: 'private',
      },
    };
    const fixture = createFixture(of(project));
    fixture.componentRef.setInput('pageTitle', 'Entities');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Entities @ DataTug Demo Project 1',
    );
  });

  it('falls back to the project id while the summary is still loading', () => {
    const project: IProjectContext = {
      ref: { projectId: 'demo-project-1', storeId: 'github.com' },
    };
    const fixture = createFixture(of(project));
    fixture.componentRef.setInput('pageTitle', 'Environments');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Environments @ demo-project-1',
    );
  });

  // Zoneless (AGENTS.md): `currentProject` is read via `toSignal`, not a
  // plain field assigned from `.subscribe()`, so a value arriving strictly
  // after the first render must still commit with no explicit
  // `detectChanges()` call — same idiom as
  // project-page.component.spec.ts's "commits the title once it arrives
  // asynchronously" test.
  it('commits the project title once it arrives asynchronously, with no explicit detectChanges()', async () => {
    const project$ = new Subject<IProjectContext | undefined>();
    const fixture = createFixture(project$);
    fixture.componentRef.setInput('pageTitle', 'Servers');
    fixture.detectChanges(); // initial render — no project has arrived yet

    expect(fixture.nativeElement.querySelector('strong')?.textContent?.trim()).toBe(
      'Servers',
    );
    expect(fixture.nativeElement.textContent).not.toContain('@');

    project$.next({
      ref: { projectId: 'demo-project-1', storeId: 'github.com' },
      brief: { title: 'DataTug Demo Project 1' },
    });

    await fixture.whenStable();

    expect(fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Servers @ DataTug Demo Project 1',
    );
  });
});
