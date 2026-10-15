import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { MyStoresComponent } from './my-stores.component';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';

describe('MyStoresComponent', () => {
  let component: MyStoresComponent;
  let fixture: ComponentFixture<MyStoresComponent>;
  let userStates$: Subject<unknown>;

  beforeEach(async () => {
    userStates$ = new Subject();
    await TestBed.configureTestingModule({
      imports: [MyStoresComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugNavService, useValue: { goStore: vi.fn() } },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: userStates$.asObservable(),
          },
        },
      ],
    })
      .overrideComponent(MyStoresComponent, {
        set: {
          imports: [],
          template:
            '<span data-testid="store-state">{{ authStatus() }}:{{ userRecordLoaded() }}:{{ stores()?.length ?? "unknown" }}</span>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MyStoresComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a user-store update emitted after the first render in zoneless mode', async () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="store-state"]')
        .textContent,
    ).toContain(':false:unknown');

    userStates$.next({ status: 'authenticated', record: null });
    await fixture.whenStable();

    expect(
      fixture.nativeElement.querySelector('[data-testid="store-state"]')
        .textContent,
    ).toMatch(/authenticated:true:\d+/);
  });
});
