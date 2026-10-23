import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  ProjectTabPanelComponent,
  matchesOverviewFilter,
} from './project-tab-panel.component';
import { ProjectOverviewCardComponent } from './project-overview-card.component';

describe('matchesOverviewFilter', () => {
  it('matches everything for an empty or blank filter', () => {
    expect(matchesOverviewFilter('', 'Alpha')).toBe(true);
    expect(matchesOverviewFilter('   ', undefined)).toBe(true);
  });

  it('matches case-insensitively across fields and requires every term', () => {
    expect(matchesOverviewFilter('CHINOOK', 'Chinook customers')).toBe(true);
    expect(
      matchesOverviewFilter('chinook sql', 'Chinook customers', 'SQL'),
    ).toBe(true);
    expect(
      matchesOverviewFilter('chinook http', 'Chinook customers', 'SQL'),
    ).toBe(false);
    expect(matchesOverviewFilter('x', null, undefined)).toBe(false);
  });
});

@Component({
  imports: [ProjectTabPanelComponent],
  template: `
    <sneat-datatug-project-tab-panel
      panelTitle="Boards"
      filterNoun="boards"
      [titleHref]="href()"
      [filterable]="filterable()"
      [(filter)]="filter"
    >
      <button tabPanelControls type="button">Header action</button>
      <p class="body">Body</p>
    </sneat-datatug-project-tab-panel>
  `,
})
class HostComponent {
  readonly href = signal<string | undefined>('/project/x/boards');
  readonly filterable = signal(true);
  readonly filter = signal('');
}

async function create() {
  await TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('ProjectTabPanelComponent', () => {
  it('renders a plain section (not a card) whose title links to the full page, with controls on the same row', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-card')).toBeNull();
    expect(el.querySelector('ion-item-divider')).toBeNull();
    const header = el.querySelector('section .tab-panel-header');
    const link = header?.querySelector('h2 a');
    expect(link?.textContent?.trim()).toBe('Boards');
    expect(link?.getAttribute('href')).toBe('/project/x/boards');
    expect(
      header?.querySelector('.tab-panel-controls button')?.textContent,
    ).toBe('Header action');
    expect(el.querySelector('section .body')).not.toBeNull();
  });

  it('shows the title without a link when the page has no exact address', async () => {
    const fixture = await create();
    fixture.componentInstance.href.set('/');
    fixture.detectChanges();
    await fixture.whenStable();
    const header = fixture.nativeElement.querySelector('.tab-panel-header');
    expect(header.querySelector('a')).toBeNull();
    expect(header.textContent).toContain('Boards');
  });

  it('writes typed filter text back to the host and clears it', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('ion-input');
    // Ionic, once defined in the shared test worker, moves the host aria-label onto its inner native input.
    expect(
      input?.getAttribute('aria-label') ??
        input?.querySelector('input')?.getAttribute('aria-label'),
    ).toBe('Filter boards');
    expect(el.querySelector('[title="Clear filter"]')).toBeNull();
    input?.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: 'sales' } }),
    );
    await fixture.whenStable();
    expect(fixture.componentInstance.filter()).toBe('sales');
    const clear = el.querySelector<HTMLElement>('[title="Clear filter"]');
    expect(clear).not.toBeNull();
    clear?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.filter()).toBe('');
  });

  it('omits the filter row when the card is not filterable', async () => {
    const fixture = await create();
    fixture.componentInstance.filterable.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('ion-input')).toBeNull();
  });
});

@Component({
  imports: [ProjectOverviewCardComponent],
  template: `<sneat-datatug-project-overview-card cardTitle="Sandbox"
    ><p class="body">Body</p></sneat-datatug-project-overview-card
  >`,
})
class CardHostComponent {}

describe('ProjectOverviewCardComponent', () => {
  it('heads a standalone card with one light divider', async () => {
    await TestBed.configureTestingModule({
      imports: [CardHostComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CardHostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const header = el.querySelector('ion-card > ion-item-divider');
    expect(header?.getAttribute('color')).toBe('light');
    expect(header?.querySelector('ion-label h2')?.innerHTML).toContain(
      'Sandbox',
    );
    expect(el.querySelector('ion-card .body')).not.toBeNull();
  });
});
