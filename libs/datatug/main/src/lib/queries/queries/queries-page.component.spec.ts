import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { QueriesPageComponent } from './queries-page.component';
import { QueriesService } from '../queries.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';

describe('SqlQueriesPage', () => {
  let component: QueriesPageComponent;
  let fixture: ComponentFixture<QueriesPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QueriesPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    })
      .overrideComponent(QueriesPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueriesPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for `NG0201: No provider found for QueriesService`, thrown for
 * real by `QueriesTabComponent` (rendered in this page's own template) on
 * every navigation to `queries` — direct URL load or in-app — because
 * neither `QueriesPageComponent` nor `QueriesTabComponent` declared any of
 * the modules that provide `QueriesService`/`DatatugNavContextService`/
 * `AppContextService`. The describe above cannot see it: it blanks this
 * component's own `imports`, so it proves the class constructs under a
 * hand-fed empty template, not that the app can build the real child tree.
 *
 * Here `QueriesPageComponent` is left exactly as production declares it —
 * `TestBed.configureTestingModule({ imports: [QueriesPageComponent] })`
 * folds its own declared `imports` (which is what this fix changed) into
 * the testing injector, the same technique
 * `env-db-table.page.spec.ts`'s "dependency injection" describe uses — and
 * only leaf I/O (HTTP, Firestore, router, navigation) is stubbed.
 */
describe('QueriesPage dependency injection', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QueriesPageComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            url: '/',
          },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
      ],
    });
  });

  it.each([['QueriesService', QueriesService]])(
    'resolves %s, which is provided by a module and never `providedIn: root`',
    (_name, token) => {
      expect(TestBed.inject(token, null)).toBeTruthy();
    },
  );

  // DatatugNavContextService is now providedIn: 'root'
  // (nav-context-root-singletons) — no longer grouped with the above.
  it('resolves DatatugNavContextService, which is `providedIn: root`', () => {
    expect(TestBed.inject(DatatugNavContextService, null)).toBeTruthy();
  });
});
