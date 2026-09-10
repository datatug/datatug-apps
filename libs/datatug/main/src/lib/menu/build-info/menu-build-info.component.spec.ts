import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuBuildInfoComponent } from './menu-build-info.component';
import { buildInfo } from './build-info';

describe('MenuBuildInfoComponent', () => {
  let component: MenuBuildInfoComponent;
  let fixture: ComponentFixture<MenuBuildInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuBuildInfoComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      // Keep the real template so the rendered text/values can be asserted,
      // but stub the Ionic elements via CUSTOM_ELEMENTS_SCHEMA (same recipe
      // as sneat-libs' AppVersionComponent spec).
      .overrideComponent(MenuBuildInfoComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(MenuBuildInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the app version', () => {
    const note = fixture.nativeElement.querySelector(
      '[data-testid="build-info-version"]',
    ) as HTMLElement;
    expect(note.textContent?.trim()).toBe(buildInfo.version);
  });

  it('renders the short git hash + build timestamp as the build input value, full hash as its title', () => {
    const input = fixture.nativeElement.querySelector(
      '[data-testid="build-info-hash"]',
    ) as HTMLElement & { value?: string; title?: string };
    expect(input.value).toBe(
      `${buildInfo.gitHash.substring(0, 7)} @ ${buildInfo.buildTimestamp}`,
    );
    expect(input.title).toBe(buildInfo.gitHash);
  });
});
