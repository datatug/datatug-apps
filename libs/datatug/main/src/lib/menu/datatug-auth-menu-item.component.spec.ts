import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { provideRouter } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuController, NavController } from '@ionic/angular';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { Subject, of } from 'rxjs';

import { DatatugAuthMenuItemComponent } from './datatug-auth-menu-item.component';

describe('DatatugAuthMenuItemComponent', () => {
  let fixture: ComponentFixture<DatatugAuthMenuItemComponent>;
  let navCtrl: { navigateRoot: ReturnType<typeof vi.fn> };
  let menuCtrl: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    navCtrl = { navigateRoot: vi.fn().mockResolvedValue(undefined) };
    menuCtrl = { close: vi.fn().mockResolvedValue(undefined) };

    await TestBed.configureTestingModule({
      imports: [DatatugAuthMenuItemComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: NavController, useValue: navCtrl },
        { provide: MenuController, useValue: menuCtrl },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'u1' } }),
            signOut: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SneatUserService,
          useValue: { userState: new Subject() },
        },
      ],
    })
      .overrideComponent(DatatugAuthMenuItemComponent, {
        set: {
          imports: [],
          template: '',

          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DatatugAuthMenuItemComponent);
  });

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('navigates to root on logout', async () => {
    const component = fixture.componentInstance;
    const click = new Event('click');
    await component.logout(click);
    expect(menuCtrl.close).toHaveBeenCalled();
    expect(navCtrl.navigateRoot).toHaveBeenCalledWith('/');
  });
});

describe('profile billing menu capability', () => {
  it.each(['datatug', 'incidentius'] as const)(
    'scopes upgrade entry for %s',
    async (profile) => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DatatugAuthMenuItemComponent],
        providers: [
          provideRouter([]),
          {
            provide: ErrorLogger,
            useValue: { logError: vi.fn(), logErrorHandler: () => vi.fn() },
          },
          { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES[profile] },
          { provide: NavController, useValue: { navigateRoot: vi.fn() } },
          { provide: MenuController, useValue: { close: vi.fn() } },
          {
            provide: SneatAuthStateService,
            useValue: {
              authState: of({
                status: 'authenticated',
                user: { uid: 'buyer' },
              }),
            },
          },
          { provide: SneatUserService, useValue: { userState: of(undefined) } },
        ],
      })
        .overrideComponent(DatatugAuthMenuItemComponent, {
          set: {
            imports: [],
            template: '',

            schemas: [CUSTOM_ELEMENTS_SCHEMA],
          },
        })
        .compileComponents();
      const fixture = TestBed.createComponent(DatatugAuthMenuItemComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance['pricingUrl']()).toBe(
        PRODUCT_PROFILES[profile].pricingUrl,
      );
      fixture.destroy();
    },
  );
});
