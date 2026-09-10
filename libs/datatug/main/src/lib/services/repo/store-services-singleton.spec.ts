import { Component, inject } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DatatugStoreGithubService } from './datatug-store.service.github';
import { DatatugServicesStoreModule } from './datatug-services-store.module';

/**
 * Regression (nav-context-root-singletons — same pattern as
 * `nav/nav-services-singleton.spec.ts`): `DatatugStoreGithubService` is
 * `@Injectable({ providedIn: 'root' })`, but until this fix it was ALSO
 * still listed in `DatatugServicesStoreModule`'s `providers:` array
 * alongside `DatatugStoreServiceFactory`/`DatatugStoreFirestoreService`. A
 * module-level provider entry shadows the root singleton in every injector
 * that imports the module, so a routed standalone component that lists
 * `DatatugServicesStoreModule` directly in its own `@Component.imports`
 * (e.g. `BoardsPageComponent`,
 * `board/ui/pages/boards/boards-page.component.ts`) got its OWN
 * environment injector carrying a fresh, shadowed
 * `DatatugStoreGithubService` instance instead of the one true root
 * instance. Concretely, `DatatugStoreGithubService.getProjectSummary`
 * caches its `datatug-project.json` fetch per instance
 * (`summaryCache: Map<string, Observable<IProjectSummary>>`) — two
 * shadowed instances would each fetch and cache independently instead of
 * sharing the app-wide cache, causing redundant HTTP requests for the same
 * project.
 *
 * Removing the class from the module's `providers:` array (root services
 * are resolved from the root injector regardless) fixes it: every injector
 * resolves the same singleton, proven below through the REAL module wiring
 * — two independently-mounted standalone components that both import
 * `DatatugServicesStoreModule`, exactly like two routed pages sharing the
 * module, resolve to the SAME `DatatugStoreGithubService` instance, equal
 * to the actual root instance.
 */

@Component({
  selector: 'sneat-store-github-consumer-a',
  template: '',
  imports: [DatatugServicesStoreModule],
})
class StoreGithubConsumerAComponent {
  readonly storeGithub = inject(DatatugStoreGithubService);
}

@Component({
  selector: 'sneat-store-github-consumer-b',
  template: '',
  imports: [DatatugServicesStoreModule],
})
class StoreGithubConsumerBComponent {
  readonly storeGithub = inject(DatatugStoreGithubService);
}

describe('DatatugStoreGithubService is an app singleton across independently-mounted standalone components', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('two independently-mounted components resolve the actual root instance', () => {
    const rootInstance = TestBed.inject(DatatugStoreGithubService);
    const a = TestBed.createComponent(StoreGithubConsumerAComponent);
    a.detectChanges();
    const b = TestBed.createComponent(StoreGithubConsumerBComponent);
    b.detectChanges();

    expect(a.componentInstance.storeGithub).toBe(rootInstance);
    expect(b.componentInstance.storeGithub).toBe(rootInstance);
    expect(a.componentInstance.storeGithub).toBe(b.componentInstance.storeGithub);
  });
});
