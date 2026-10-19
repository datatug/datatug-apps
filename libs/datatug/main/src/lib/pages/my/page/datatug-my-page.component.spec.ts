import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { signal } from '@angular/core';
import { HostedCloudLogsAccessService } from '../cloud-logs/hosted-cloud-logs-access.service';

import { DatatugMyPageComponent } from './datatug-my-page.component';

describe('MyPage', () => {
  let component: DatatugMyPageComponent;
  let fixture: ComponentFixture<DatatugMyPageComponent>;
  let accessState: ReturnType<typeof signal<{ status: string }>>;
  const access = {
    state: undefined as unknown as () => { status: string },
    retry: vi.fn(),
  };

  beforeEach(async () => {
    accessState = signal({ status: 'disabled' });
    access.state = accessState;
    access.retry.mockReset();
    await TestBed.configureTestingModule({
      imports: [DatatugMyPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: HostedCloudLogsAccessService, useValue: access },
      ],
    })
      .overrideComponent(DatatugMyPageComponent, {
        set: {
          imports: [RouterLink],
          template:
            '<a routerLink="/subscriptions" [queryParams]="subscriptionQuery()">Subscriptions</a>@if (enableHostedCloudLogs()) { <a routerLink="/my/cloud-logs">Google Cloud log connections</a> }@if (hostedCloudLogsAccess.state().status === \'checking\') { <p role="status">Checking access</p> }@if (hostedCloudLogsAccess.state().status === \'error\') { <p role="alert">Could not verify access</p><button (click)="retryHostedCloudLogsAccess()">Retry</button> }@if (hostedCloudLogsAccess.state().status === \'denied\') { <button (click)="retryHostedCloudLogsAccess()">Check access again</button> }@if (hostedCloudLogsAccess.state().status === \'auth-error\') { <p role="alert">We could not verify your sign-in</p><button (click)="retryAuthenticationCheck()">Reload sign-in check</button> }',
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

  it('hides the hosted log route link until the server confirms access', () => {
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/my/cloud-logs"]'),
    ).toBeNull();
  });

  it('shows the hosted log route link after the server confirms access', () => {
    accessState.set({ status: 'allowed' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/my/cloud-logs"]'),
    ).not.toBeNull();
  });

  it('shows an accessible loading state and a retry action on transient errors', () => {
    accessState.set({ status: 'checking' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="status"]')?.textContent,
    ).toContain('Checking');

    accessState.set({ status: 'error' });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('Could not verify');
    fixture.nativeElement.querySelector('button').click();
    expect(access.retry).toHaveBeenCalledOnce();
  });

  it('shows an actionable recovery state when sign-in could not be verified', () => {
    accessState.set({ status: 'auth-error' });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('could not verify your sign-in');
    expect(
      fixture.nativeElement.querySelector('button')?.textContent,
    ).toContain('Reload sign-in check');
  });

  it('offers an explicit recheck after a server denial', () => {
    accessState.set({ status: 'denied' });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();

    expect(access.retry).toHaveBeenCalledOnce();
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
