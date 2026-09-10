import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BUILD_INFO, IBuildInfo } from '@sneat/core-public';
import { MenuBuildInfoComponent } from './menu-build-info.component';

// Matches this component's own FALLBACK_BUILD_INFO (menu-build-info.component.ts)
// — the committed placeholders from apps/datatug-app/src/build-info.ts, which
// a lib can't import directly (@nx/enforce-module-boundaries).
const placeholderBuildInfo: IBuildInfo = {
  version: 'version t0be$et',
  gitHash: 'gitHash t0be$et',
  buildTimestamp: 'timestamp t0be$et',
};

describe('MenuBuildInfoComponent', () => {
  let component: MenuBuildInfoComponent;
  let fixture: ComponentFixture<MenuBuildInfoComponent>;

  const toggleRow = (): HTMLElement =>
    fixture.nativeElement.querySelector(
      '[data-testid="build-info-toggle"]',
    ) as HTMLElement;

  const createFixture = async (
    provideBuildInfoValue?: IBuildInfo,
  ): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [MenuBuildInfoComponent],
      providers: provideBuildInfoValue
        ? [{ provide: BUILD_INFO, useValue: provideBuildInfoValue }]
        : [],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(MenuBuildInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await createFixture();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a collapsed footer row by default, with no version/hash lines', () => {
    expect(toggleRow()).toBeTruthy();
    expect(toggleRow().getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid="build-info-version"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="build-info-hash"]'),
    ).toBeNull();
  });

  it('shows the Sneat.Work copyright line ending in the current year (unstamped build)', () => {
    // Unstamped: no BUILD_INFO provided, so the component falls back to its
    // own placeholder (FALLBACK_BUILD_INFO), whose buildTimestamp is not a
    // valid date — the component falls back to the current year rather than
    // rendering "NaN".
    const text = toggleRow().textContent ?? '';
    expect(text).toContain(`2020 - ${new Date().getUTCFullYear()}`);
    expect(text).toContain('Sneat.Work');
  });

  it('links Sneat.Work to https://sneat.work in a new tab', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://sneat.work');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('expands to reveal the version and build lines when the row is tapped', () => {
    toggleRow().click();
    fixture.detectChanges();

    expect(toggleRow().getAttribute('aria-expanded')).toBe('true');

    const version = fixture.nativeElement.querySelector(
      '[data-testid="build-info-version"]',
    ) as HTMLElement;
    expect(version.textContent?.trim()).toBe(
      `Version v${placeholderBuildInfo.version}`,
    );

    const hash = fixture.nativeElement.querySelector(
      '[data-testid="build-info-hash"]',
    ) as HTMLElement;
    expect(hash.textContent?.trim()).toBe(
      `Build ${placeholderBuildInfo.gitHash.substring(0, 7)} @ ${placeholderBuildInfo.buildTimestamp}`,
    );
  });

  it('collapses again on a second tap, hiding the version/build lines', () => {
    toggleRow().click();
    fixture.detectChanges();
    toggleRow().click();
    fixture.detectChanges();

    expect(toggleRow().getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid="build-info-version"]'),
    ).toBeNull();
  });

  it('clicking the link does not toggle the expanded state', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    // jsdom/happy-dom navigation to an external href isn't relevant here —
    // only that the click doesn't bubble up to the ion-item's toggle handler.
    link.dispatchEvent(event);
    fixture.detectChanges();

    expect(toggleRow().getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the injected BUILD_INFO when the app calls provideBuildInfo()', async () => {
    const stamped: IBuildInfo = {
      version: '1.2.3',
      gitHash: 'abcdef1234567890',
      buildTimestamp: '2026-09-10T12:00:00.000Z',
    };
    // beforeEach already configured/instantiated TestBed with no provider —
    // reset before configuring it again with one, or TestBed throws
    // "Cannot configure the test module when the test module has already
    // been instantiated".
    TestBed.resetTestingModule();
    await createFixture(stamped);

    toggleRow().click();
    fixture.detectChanges();

    const version = fixture.nativeElement.querySelector(
      '[data-testid="build-info-version"]',
    ) as HTMLElement;
    expect(version.textContent?.trim()).toBe('Version v1.2.3');

    // Build year (from buildTimestamp) drives the collapsed row's end year.
    expect(toggleRow().textContent).toContain('2026');
  });
});
