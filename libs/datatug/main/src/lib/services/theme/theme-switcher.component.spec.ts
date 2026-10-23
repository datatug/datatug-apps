import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ThemeSwitcherComponent } from './theme-switcher.component';
import { ThemeService } from './theme.service';

describe('ThemeSwitcherComponent', () => {
  it('offers Light, Dark and Auto and passes a change to ThemeService', () => {
    TestBed.configureTestingModule({
      imports: [ThemeSwitcherComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    const fixture = TestBed.createComponent(ThemeSwitcherComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      Array.from(el.querySelectorAll('ion-segment-button')).map((b) =>
        b.getAttribute('value'),
      ),
    ).toEqual(['light', 'dark', 'auto']);

    const segment = el.querySelector('ion-segment') as HTMLElement;
    segment.dispatchEvent(
      new CustomEvent('ionChange', { detail: { value: 'dark' } }),
    );
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
    localStorage.clear();
    document.documentElement.classList.remove('ion-palette-dark');
  });
});
