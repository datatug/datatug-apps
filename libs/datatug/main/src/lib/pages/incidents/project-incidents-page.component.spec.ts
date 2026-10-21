import { Component, type Signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { projectPageHref } from '../../nav/project-page-href';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { ProjectIncidentsPageComponent } from './project-incidents-page.component';

@Component({ template: '' })
class RouteTargetComponent {}

const ordinaryProject = {
  ref: {
    storeId: 'http-127.0.0.1:18989',
    projectId: 'datatug-demo-project',
  },
};
const canonicalProject = { ref: DEMO_PROJECT_REF };
const ordinaryIncidentsUrl =
  '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents';
const canonicalIncidentsUrl = projectPageHref(DEMO_PROJECT_REF, 'incidents');

describe('ProjectIncidentsPageComponent', () => {
  let ambientProject: BehaviorSubject<
    typeof ordinaryProject | typeof canonicalProject | undefined
  >;
  let fixture: ComponentFixture<ProjectIncidentsPageComponent>;
  let router: Router;

  const publicDemo = (): boolean =>
    (
      fixture.componentInstance as unknown as {
        publicDemo: Signal<boolean>;
      }
    ).publicDemo();

  beforeEach(async () => {
    ambientProject = new BehaviorSubject<
      typeof ordinaryProject | typeof canonicalProject | undefined
    >(undefined);
    await TestBed.configureTestingModule({
      imports: [ProjectIncidentsPageComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteTargetComponent }]),
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: ambientProject },
        },
      ],
    })
      .overrideComponent(ProjectIncidentsPageComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();
    router = TestBed.inject(Router);
  });

  const createAt = async (url: string): Promise<void> => {
    await router.navigateByUrl(url);
    fixture = TestBed.createComponent(ProjectIncidentsPageComponent);
    fixture.detectChanges();
  };

  it.each([
    [canonicalIncidentsUrl, true],
    [ordinaryIncidentsUrl, false],
  ] as const)(
    'selects the correct page on a cold URL without ambient project state: %s',
    async (url, expected) => {
      await createAt(url);

      expect(publicDemo()).toBe(expected);
    },
  );

  it('follows canonical to ordinary navigation while ambient context is stale canonical', async () => {
    ambientProject.next(canonicalProject);
    await createAt(canonicalIncidentsUrl);
    expect(publicDemo()).toBe(true);

    await router.navigateByUrl(ordinaryIncidentsUrl);
    fixture.detectChanges();

    expect(ambientProject.value).toEqual(canonicalProject);
    expect(publicDemo()).toBe(false);
  });

  it('follows ordinary to canonical navigation while ambient context is stale ordinary', async () => {
    ambientProject.next(ordinaryProject);
    await createAt(ordinaryIncidentsUrl);
    expect(publicDemo()).toBe(false);

    await router.navigateByUrl(canonicalIncidentsUrl);
    fixture.detectChanges();

    expect(ambientProject.value).toEqual(ordinaryProject);
    expect(publicDemo()).toBe(true);
  });
});
