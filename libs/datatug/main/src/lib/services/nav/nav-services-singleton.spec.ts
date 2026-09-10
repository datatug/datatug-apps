import { Component, inject } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { DatatugNavContextService } from './datatug-nav-context.service';
import { DatatugNavService } from './datatug-nav.service';
import { DatatugServicesNavModule } from './datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../project/datatug-services-project.module';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';

/**
 * Regression (nav-context-root-singletons, follows lane S79/S92's
 * `providedIn: 'root'` fixes for `DatatugNavService`/`DatatugUserService`):
 * `DatatugNavContextService`, `ProjectContextService`, `AppContextService`,
 * `EnvironmentService` and `StoreApiService` used to be plain `@Injectable()`s
 * provided only via `@NgModule({ providers: [...] })`. Every standalone
 * component that lists such a module in its own `imports` gets its OWN
 * environment injector carrying a fresh copy of that module's providers — so
 * two independently-mounted components (e.g. the side menu and a routed page,
 * both importing `DatatugServicesNavModule`) each got their OWN
 * `DatatugNavContextService` instance, each running its own
 * `NavigationEnd` subscription and able to desync "menu current project" from
 * "page current project" (confirmed live: two distinct instance ids logged
 * for one project page load). `DatatugNavService` carried the identical bug
 * despite already being `@Injectable({ providedIn: 'root' })`: it was STILL
 * also listed in `DatatugServicesNavModule`'s `providers:` array, and a
 * module-level provider entry shadows the root singleton in every injector
 * that imports the module, so it never actually resolved to the one true
 * root instance from a component that imported the module.
 *
 * `providedIn: 'root'` plus removing the class from every `providers:` array
 * fixes both flavours of the bug at once: every injector, regardless of
 * which module a component happens to import, resolves the same singleton.
 *
 * Each `it` below proves this through the REAL module wiring — the test
 * components declare nothing but the production `imports:` a real page
 * component would use, so on the unfixed code these fail exactly the way the
 * app did live (either a mismatched-instance assertion, or, where the
 * unfixed chain has a transitive gap a real page works around by importing
 * more modules than just this one, a construction-time `NullInjectorError` —
 * both are valid proof the current wiring does not give every consumer the
 * same singleton).
 */

@Component({
  selector: 'sneat-nav-context-consumer-a',
  template: '',
  imports: [DatatugServicesNavModule],
})
class NavContextConsumerAComponent {
  readonly navContext = inject(DatatugNavContextService);
}

@Component({
  selector: 'sneat-nav-context-consumer-b',
  template: '',
  imports: [DatatugServicesNavModule],
})
class NavContextConsumerBComponent {
  readonly navContext = inject(DatatugNavContextService);
}

@Component({
  selector: 'sneat-nav-service-consumer-a',
  template: '',
  imports: [DatatugServicesNavModule],
})
class NavServiceConsumerAComponent {
  readonly navService = inject(DatatugNavService);
}

@Component({
  selector: 'sneat-nav-service-consumer-b',
  template: '',
  imports: [DatatugServicesNavModule],
})
class NavServiceConsumerBComponent {
  readonly navService = inject(DatatugNavService);
}

@Component({
  selector: 'sneat-project-context-consumer-a',
  template: '',
  imports: [DatatugServicesProjectModule],
})
class ProjectContextConsumerAComponent {
  readonly projectContext = inject(ProjectContextService);
}

@Component({
  selector: 'sneat-project-context-consumer-b',
  template: '',
  imports: [DatatugServicesProjectModule],
})
class ProjectContextConsumerBComponent {
  readonly projectContext = inject(ProjectContextService);
}

describe('nav/project services are app singletons across independently-mounted standalone components', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { events: of(), navigate: vi.fn() } },
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(), navigateRoot: vi.fn() },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        // ProjectService is `providedIn: 'root'` too on this branch — faked
        // here purely because the real class pulls in the Firestore/
        // store-factory dependency chain (`DatatugStoreServiceFactory`) that
        // this spec doesn't want to stand up. `DatatugNavContextService`/
        // `EnvironmentService` (both root-provided by this branch) resolve
        // their own `inject(ProjectService)` from the root injector, so this
        // mock just needs to be registered as a root provider override.
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: vi.fn(() => of(undefined)),
            getFull: vi.fn(() => of(undefined)),
          },
        },
      ],
    });
  });

  it('DatatugNavContextService: two independently-mounted components resolve the SAME instance', () => {
    const a = TestBed.createComponent(NavContextConsumerAComponent);
    a.detectChanges();
    const b = TestBed.createComponent(NavContextConsumerBComponent);
    b.detectChanges();

    expect(a.componentInstance.navContext).toBe(b.componentInstance.navContext);
    expect(a.componentInstance.navContext.id).toBe(
      b.componentInstance.navContext.id,
    );
  });

  it('ProjectContextService: two independently-mounted components resolve the SAME instance', () => {
    const a = TestBed.createComponent(ProjectContextConsumerAComponent);
    a.detectChanges();
    const b = TestBed.createComponent(ProjectContextConsumerBComponent);
    b.detectChanges();

    expect(a.componentInstance.projectContext).toBe(
      b.componentInstance.projectContext,
    );
  });

  it('DatatugNavService: two independently-mounted components resolve the actual root instance', () => {
    const rootInstance = TestBed.inject(DatatugNavService);
    const a = TestBed.createComponent(NavServiceConsumerAComponent);
    a.detectChanges();
    const b = TestBed.createComponent(NavServiceConsumerBComponent);
    b.detectChanges();

    expect(a.componentInstance.navService).toBe(rootInstance);
    expect(b.componentInstance.navService).toBe(rootInstance);
  });
});
