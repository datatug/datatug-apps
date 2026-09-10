import { Component, inject } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import { of } from 'rxjs';

import { QueryEditorStateService } from './query-editor-state-service';
import { QueriesUiService } from './queries-ui.service';
import { DatatugQueriesServicesModule } from './datatug-queries-services.module';
import { DatatugNavService } from '../services/nav/datatug-nav.service';

/**
 * Regression (S157, founder report 2026-09-10: selecting the side menu's
 * "Active Queries" tab threw `NG0201: No provider found for
 * QueryEditorStateService`): `QueryEditorStateService` and `QueriesUiService`
 * used to be plain `@Injectable()`s, provided only via
 * `DatatugQueriesServicesModule`/`DatatugQueriesUiModule`'s own `providers:`
 * arrays. `QueriesMenuComponent` (the side-menu tab's component) injects
 * both directly, but neither it nor any of its ancestors
 * (`ProjectMenuComponent` → `DatatugMenuComponent`, the side menu's host)
 * ever imports either module — only `QueryPageComponent`/
 * `QueriesPageComponent` do, in their own `imports:`. So the menu-side
 * consumer below (which deliberately imports NEITHER module, exactly like
 * `QueriesMenuComponent`'s own `imports:`) could not construct at all.
 *
 * `providedIn: 'root'` on both services (plus removing them from every
 * `providers:` array — a module-level entry shadows the root singleton in
 * every injector that imports that module, same trap PR #96/#115 fixed for
 * other services) fixes this two ways at once: every injector can resolve
 * them regardless of which module a component happens to import, AND the
 * menu and the query pages now share the ONE app-wide "active queries"
 * state instance the feature is meant to have (`queries-menu.component.ts`
 * and `query/page/query-page.component.ts` both read/write it).
 *
 * Getting `QueryEditorStateService` itself to `providedIn: 'root'` was not
 * enough on its own: its constructor eagerly `inject(QueriesService)`s, and
 * a `providedIn: 'root'` service's `inject()` calls always resolve against
 * the ROOT injector, never against whichever leaf component's `imports:`
 * happened to trigger its first construction (this repo's own 2234728
 * "make ProjectService an app singleton too" commit hit the identical
 * trap). So `QueriesService` (and its own `QUERY_PROJ_ITEM_SERVICE` +
 * `ProjectItemServiceFactory` dependencies) had to become root-resolvable
 * too — see those files' own comments.
 *
 * Proven below through the REAL module wiring, exactly like
 * `services/nav/nav-services-singleton.spec.ts` and
 * `services/repo/store-services-singleton.spec.ts` do for their own
 * services: one test component declares NO service-providing module in its
 * own `imports:` (`QueriesMenuComponent`'s real shape), the other imports
 * `DatatugQueriesServicesModule` directly (`QueryPageComponent`'s real
 * shape) — both must resolve the exact same `QueryEditorStateService`
 * instance as `TestBed.inject(...)`.
 */

@Component({
  selector: 'sneat-query-editor-state-menu-consumer',
  template: '',
})
class QueryEditorStateMenuConsumerComponent {
  readonly queryEditorState = inject(QueryEditorStateService);
  readonly queriesUi = inject(QueriesUiService);
}

@Component({
  selector: 'sneat-query-editor-state-page-consumer',
  template: '',
  imports: [DatatugQueriesServicesModule],
})
class QueryEditorStatePageConsumerComponent {
  readonly queryEditorState = inject(QueryEditorStateService);
}

describe('QueryEditorStateService/QueriesUiService are app singletons shared by the side-menu tab and the query pages', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Firestore/StoreApiService/GithubProjectReaderService/DatatugNavContextService
        // etc. are all left to construct for REAL off these few mocks —
        // exactly the same minimal set `query/page/query-page.component.spec.ts`'s
        // own "QueryPageComponent dependency injection" describe block proves
        // suffices for this same transitive chain.
        { provide: Firestore, useValue: {} },
        {
          provide: Router,
          useValue: { events: of(), navigate: vi.fn(() => Promise.resolve(true)) },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        // `RandomIdService` (QueriesUiService's own dependency) is
        // `@Injectable()` with no `providedIn` — the real app provides it
        // (alongside `RANDOM_ID_OPTIONS`) at the bootstrap root
        // (apps/datatug-app/src/main.ts), not via any datatug-main module.
        RandomIdService,
        { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
        {
          provide: ActionSheetController,
          useValue: {
            create: vi.fn(() =>
              Promise.resolve({ present: vi.fn(), onDidDismiss: vi.fn() }),
            ),
          },
        },
        { provide: DatatugNavService, useValue: { goQuery: vi.fn() } },
      ],
    });
  });

  it('the menu-side consumer (no service module imported — QueriesMenuComponent\'s own wiring) and the query-page-side consumer (imports DatatugQueriesServicesModule — QueryPageComponent\'s own wiring) resolve the SAME QueryEditorStateService, equal to TestBed.inject(...)', () => {
    // Constructing the menu-side consumer first: this is the exact
    // construction that threw `NG0201: No provider found for
    // QueryEditorStateService` live (S157) before this fix.
    const menuFixture = TestBed.createComponent(
      QueryEditorStateMenuConsumerComponent,
    );
    expect(() => menuFixture.detectChanges()).not.toThrow();

    const rootQueryEditorState = TestBed.inject(QueryEditorStateService);
    const rootQueriesUi = TestBed.inject(QueriesUiService);

    expect(menuFixture.componentInstance.queryEditorState).toBe(
      rootQueryEditorState,
    );
    expect(menuFixture.componentInstance.queriesUi).toBe(rootQueriesUi);

    const pageFixture = TestBed.createComponent(
      QueryEditorStatePageConsumerComponent,
    );
    expect(() => pageFixture.detectChanges()).not.toThrow();

    expect(pageFixture.componentInstance.queryEditorState).toBe(
      rootQueryEditorState,
    );
  });
});
