import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { IncidentEmptyStateComponent } from './incident-empty-state.component';

describe('IncidentEmptyStateComponent', () => {
  async function mount(link?: string, canCreate = true) {
    await TestBed.configureTestingModule({
      imports: [IncidentEmptyStateComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(IncidentEmptyStateComponent);
    fixture.componentRef.setInput('createLink', link);
    fixture.componentRef.setInput('queryParams', {
      agent: 'localhost:8989',
      project: 'ops',
      environment: 'staging',
      branch: 'main',
    });
    fixture.componentRef.setInput('canCreate', canCreate);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('routes both actions to the same create screen with scope and only a static test marker', async () => {
    const fixture = await mount('/incidents/new');
    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((element) => element.injector.get(RouterLink));
    expect(links).toHaveLength(2);
    expect(links[0].urlTree?.toString()).toBe(
      '/incidents/new?agent=localhost:8989&project=ops&environment=staging&branch=main&draft=test',
    );
    expect(links[1].urlTree?.toString()).toBe(
      '/incidents/new?agent=localhost:8989&project=ops&environment=staging&branch=main',
    );
    expect(fixture.nativeElement.textContent).toContain('Nothing is saved');
  });

  it('keeps the hosted project URL and environment intact', async () => {
    const href = '/space/private/store/firestore/project/ops/incidents/new';
    const fixture = await mount(href);
    const link = fixture.debugElement
      .query(By.directive(RouterLink))
      .injector.get(RouterLink);
    expect(link.urlTree?.toString()).toContain(href + '?');
    expect(link.urlTree?.queryParams['environment']).toBe('staging');
  });

  it('shows setup guidance without a broken create action when no project is connected', async () => {
    const fixture = await mount();
    expect(
      fixture.debugElement.queryAll(By.directive(RouterLink)),
    ).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain(
      'set up a private project',
    );
  });

  it('disables both create actions for a read-only project', async () => {
    const fixture = await mount('/incidents/new', false);
    for (const button of fixture.nativeElement.querySelectorAll('ion-button'))
      expect(button.disabled).toBe(true);
  });
});
