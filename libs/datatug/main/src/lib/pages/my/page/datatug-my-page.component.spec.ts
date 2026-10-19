import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { EnvConfigToken } from '@sneat/core';

import { DatatugMyPageComponent } from './datatug-my-page.component';

describe('MyPage', () => {
  let component: DatatugMyPageComponent;
  let fixture: ComponentFixture<DatatugMyPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugMyPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideRouter([]),
        {
          provide: EnvConfigToken,
          useValue: { hostedCloudLogsEnabled: false },
        },
      ],
    })
      .overrideComponent(DatatugMyPageComponent, {
        set: {
          imports: [RouterLink],
          template:
            '<a routerLink="/subscriptions" [queryParams]="subscriptionQuery()">Subscriptions</a>@if (enableHostedCloudLogs) { <a routerLink="/my/cloud-logs">Google Cloud log connections</a> }',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DatatugMyPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('hides the hosted log route link while the feature flag is off', () => {
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/my/cloud-logs"]'),
    ).toBeNull();
  });

  it('shows the hosted log route link when the feature flag is enabled', () => {
    Object.defineProperty(component, 'enableHostedCloudLogs', { value: true });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/my/cloud-logs"]'),
    ).not.toBeNull();
  });

  it('keeps the subscriptions link on the current rail after account query changes', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?checkout=test');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(
      '/subscriptions?checkout=test',
    );
    await router.navigateByUrl('/');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(
      '/subscriptions',
    );
  });
});
