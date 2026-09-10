import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuBuildInfoComponent } from './menu-build-info.component';
import { buildInfo } from './build-info';

describe('MenuBuildInfoComponent', () => {
  let component: MenuBuildInfoComponent;
  let fixture: ComponentFixture<MenuBuildInfoComponent>;

  const toggleRow = (): HTMLElement =>
    fixture.nativeElement.querySelector(
      '[data-testid="build-info-toggle"]',
    ) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuBuildInfoComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(MenuBuildInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
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

  it('shows the DataTug copyright line ending in the current year (unstamped build)', () => {
    // Unstamped in a unit test (no Nx dependsOn from `test` on `build` —
    // see build-info.ts's header comment), so buildInfo.buildTimestamp is
    // still the committed placeholder and the component falls back to the
    // current year rather than rendering "NaN".
    const text = toggleRow().textContent ?? '';
    expect(text).toContain(`2020 - ${new Date().getUTCFullYear()}`);
    expect(text).toContain('DataTug.app');
  });

  it('links DataTug.app to https://datatug.app in a new tab', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://datatug.app');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('expands to reveal the version and build lines when the row is tapped', () => {
    toggleRow().click();
    fixture.detectChanges();

    expect(toggleRow().getAttribute('aria-expanded')).toBe('true');

    const version = fixture.nativeElement.querySelector(
      '[data-testid="build-info-version"]',
    ) as HTMLElement;
    expect(version.textContent?.trim()).toBe(`Version v${buildInfo.version}`);

    const hash = fixture.nativeElement.querySelector(
      '[data-testid="build-info-hash"]',
    ) as HTMLElement;
    expect(hash.textContent?.trim()).toBe(
      `Build ${buildInfo.gitHash.substring(0, 7)} @ ${buildInfo.buildTimestamp}`,
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
});
