import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MenuController, NavController } from '@ionic/angular/standalone';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { Subject, of } from 'rxjs';

import { DatatugAuthMenuItemComponent } from './datatug-auth-menu-item.component';

describe('DatatugAuthMenuItemComponent', () => {
  let fixture: ComponentFixture<DatatugAuthMenuItemComponent>;
  let navCtrl: { navigateRoot: ReturnType<typeof vi.fn> };
  let menuCtrl: { close: ReturnType<typeof vi.fn> };

  beforeEach(waitForAsync(async () => {
    navCtrl = { navigateRoot: vi.fn().mockResolvedValue(undefined) };
    menuCtrl = { close: vi.fn().mockResolvedValue(undefined) };

    await TestBed.configureTestingModule({
      imports: [DatatugAuthMenuItemComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
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
  }));

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
