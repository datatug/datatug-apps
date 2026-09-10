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
    }).compileComponents();
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

  it('renders the short git hash + build timestamp as the build input value', () => {
    // Not asserting the [title]="buildInfo.gitHash" binding here: ion-input
    // (a Stencil web component) moves host-level "title" onto its internal
    // shadow-DOM <input> for accessibility rather than reflecting it back
    // onto the host element/property, so it isn't observable this way in a
    // unit test — verified empirically, not a bug in the component. The
    // template still sets it (see menu-build-info.component.html) so a real
    // browser tooltip on the build row shows the full hash.
    const input = fixture.nativeElement.querySelector(
      '[data-testid="build-info-hash"]',
    ) as HTMLElement & { value?: string };
    expect(input.value).toBe(
      `${buildInfo.gitHash.substring(0, 7)} @ ${buildInfo.buildTimestamp}`,
    );
  });
});
