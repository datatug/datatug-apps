import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MenuController } from '@ionic/angular/menu-controller';
import { ErrorLogger } from '@sneat/core';

import { DatatugAppComponent } from './datatug-app.component';

describe('AppComponent', () => {
  let fixture: ComponentFixture<DatatugAppComponent>;
  let menuCtrl: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    menuCtrl = { close: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [DatatugAppComponent],
      providers: [
        provideRouter([]),
        { provide: MenuController, useValue: menuCtrl },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DatatugAppComponent);
  });

  it('should create the app', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the brand as a link to the home route', () => {
    fixture.detectChanges();

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');

    expect(link).toBeTruthy();
    expect(link.getAttribute('aria-label')).toBe('DataTug.app home');
    expect(link.textContent?.trim()).toBe('DataTug.app');
  });

  it('navigates to the home route when the brand link is activated', async () => {
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');
    link.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalled();
    const target = navigateSpy.mock.calls[0][0];
    expect(target.toString()).toBe('/');
  });

  it('closes the side menu when the brand link is activated', () => {
    fixture.detectChanges();

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.brand-home-link');
    link.click();

    expect(menuCtrl.close).toHaveBeenCalled();
  });
});
