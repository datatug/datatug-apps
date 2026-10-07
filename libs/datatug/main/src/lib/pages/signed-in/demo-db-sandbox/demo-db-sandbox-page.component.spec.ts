import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  DatatugUserService,
  IDatatugUserState,
} from '../../../services/base/datatug-user-service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DemoDbSandboxPageComponent } from './demo-db-sandbox-page.component';
import { DemoDbSandboxService } from './demo-db-sandbox.service';

const sandboxInfo = {
  databases: [
    'chinook',
    'northwind',
    'pubs',
    'sakila',
    'adventureworks',
    'employees',
  ],
  createdAt: '2026-10-07T10:00:00Z',
  lastActivityAt: '2026-10-07T10:00:00Z',
  idleExpiresAt: '2026-10-14T10:00:00Z',
  sampleDatabaseBytes: 100_000,
  sampleGrowthLimitBytes: 110_000,
  branchLogicalBytes: 100_000,
} as const;

describe('DemoDbSandboxPageComponent', () => {
  const signedOut: IDatatugUserState = {
    status: 'notAuthenticated',
    user: null,
    record: null,
  };
  const signedIn: IDatatugUserState = {
    status: 'authenticated',
    user: { uid: 'registered-user', isAnonymous: false },
    record: null,
  };
  const anonymous: IDatatugUserState = {
    status: 'authenticated',
    user: { uid: 'anonymous-user', isAnonymous: true },
    record: null,
  };

  function setup(
    initialUser: IDatatugUserState,
    sandboxApi: {
      get: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
    },
  ) {
    const userState = new BehaviorSubject(initialUser);
    TestBed.configureTestingModule({
      imports: [DemoDbSandboxPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DatatugUserService,
          useValue: { datatugUserState: userState },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(undefined) },
        },
        {
          provide: DatatugNavService,
          useValue: { projectPageUrl: vi.fn(() => '/') },
        },
        { provide: DemoDbSandboxService, useValue: sandboxApi },
      ],
    });
    const fixture = TestBed.createComponent(DemoDbSandboxPageComponent);
    fixture.detectChanges();
    return { fixture, userState };
  }

  it('does not request a sandbox while signed out and offers the existing sign-in route', () => {
    const api = {
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    const { fixture } = setup(signedOut, api);

    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Sign in to use a private sandbox',
    );
    expect(
      fixture.nativeElement
        .querySelector('ion-button')
        ?.getAttribute('routerLink'),
    ).toBe('/login');
  });

  it('does not expose registered-user sandbox controls to an anonymous Firebase user', () => {
    const api = {
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    const { fixture } = setup(anonymous, api);

    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'You are signed in anonymously',
    );
    expect(fixture.nativeElement.textContent).toContain('Register');
    expect(
      fixture.nativeElement
        .querySelector('ion-button')
        ?.getAttribute('routerLink'),
    ).toBe('/login');
  });

  it('creates one account sandbox, runs a DML statement against a selected database, and deletes it', async () => {
    const queryResult = {
      columns: [{ name: 'command', typeOid: 25 }],
      rows: [['UPDATE 1']],
      command: 'UPDATE 1',
    };
    const api = {
      get: vi
        .fn()
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 404 })),
        )
        .mockReturnValue(of(sandboxInfo)),
      create: vi.fn(() => of(sandboxInfo)),
      delete: vi.fn(() => of({})),
      query: vi.fn(() => of(queryResult)),
    };
    const { fixture } = setup(signedIn, api);
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      createSandbox(): Promise<void>;
      runQuery(): Promise<void>;
      deleteSandbox(): Promise<void>;
      confirmDelete(): Promise<void>;
      database: { set(value: string): void };
      sql: { set(value: string): void };
      argsText: { set(value: string): void };
      pageState(): string;
    };

    expect(page.pageState()).toBe('not-created');
    await page.createSandbox();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][0]).toEqual(expect.any(String));
    expect(page.pageState()).toBe('ready');
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain(
      'Maximum combined sample database size',
    );
    expect(fixture.nativeElement.innerHTML).toContain('107.4 KiB');
    expect(fixture.nativeElement.innerHTML).toContain(
      'Last measured branch size',
    );

    page.database.set('northwind');
    page.sql.set('UPDATE customers SET city = $1 WHERE id = $2');
    page.argsText.set('["Dublin", "9007199254740993"]');
    await page.runQuery();
    fixture.detectChanges();
    expect(api.query).toHaveBeenCalledWith({
      database: 'northwind',
      sql: 'UPDATE customers SET city = $1 WHERE id = $2',
      args: ['Dublin', '9007199254740993'],
    });
    expect(fixture.nativeElement.textContent).toContain('UPDATE 1');

    await page.deleteSandbox();
    expect(api.delete).not.toHaveBeenCalled();
    await page.confirmDelete();
    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(page.pageState()).toBe('not-created');
  });

  it('reports backend setup as unavailable instead of claiming a sandbox exists', async () => {
    const api = {
      get: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 503 })),
      ),
      create: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
    };
    const { fixture } = setup(signedIn, api);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Sandbox setup is not available right now',
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it('renders joined query results with duplicate column names', async () => {
    const joinedResult = {
      columns: [
        { name: 'id', typeOid: 23 },
        { name: 'id', typeOid: 23 },
      ],
      rows: [['10', '20']],
      command: 'SELECT 1',
    };
    const api = {
      get: vi.fn(() => of(sandboxInfo)),
      create: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(() => of(joinedResult)),
    };
    const { fixture } = setup(signedIn, api);
    await fixture.whenStable();
    const page = fixture.componentInstance as unknown as {
      runQuery(): Promise<void>;
      sql: { set(value: string): void };
      pageState(): string;
    };
    expect(page.pageState()).toBe('ready');
    page.sql.set(
      'SELECT a.id, b.id FROM first_table a JOIN second_table b ON a.id = b.id',
    );

    await page.runQuery();
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('thead th');
    const cells = fixture.nativeElement.querySelectorAll('tbody td');
    expect(headers).toHaveLength(2);
    expect([...headers].map((header) => header.textContent?.trim())).toEqual([
      'id',
      'id',
    ]);
    expect([...cells].map((cell) => cell.textContent?.trim())).toEqual([
      '10',
      '20',
    ]);
  });
});
