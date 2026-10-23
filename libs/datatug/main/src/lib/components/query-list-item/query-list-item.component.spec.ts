import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUERY_PREVIEW_LINES,
  QueryListItemComponent,
  queryPreviewText,
} from './query-list-item.component';

describe('queryPreviewText', () => {
  it('keeps short text and cuts long text to the preview lines', () => {
    expect(queryPreviewText('select 1\n')).toBe('select 1');
    const long = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(
      '\n',
    );
    const lines = queryPreviewText(long)?.split('\n') ?? [];
    expect(lines).toHaveLength(QUERY_PREVIEW_LINES + 1);
    expect(lines.at(-1)).toBe('…');
  });

  it('has nothing to show for empty text', () => {
    expect(queryPreviewText(undefined)).toBeUndefined();
    expect(queryPreviewText('  \n ')).toBeUndefined();
  });
});

@Component({ template: '' })
class RouteStubComponent {}

@Component({
  imports: [QueryListItemComponent],
  template: `
    <sneat-datatug-query-list-item
      queryTitle="Orders by country"
      type="SQL"
      createdAt="2024-01-05T12:00:00Z"
      [href]="href()"
      titleTestId="saved-query-orders"
      itemTestId="row"
      [loadText]="loadText()"
      (opened)="opened = opened + 1"
    >
      <span queryRowSubtitle class="subtitle">Folder: sales/</span>
      <button queryRowActions slot="end" class="action" type="button">
        Run
      </button>
    </sneat-datatug-query-list-item>
  `,
})
class HostComponent {
  opened = 0;
  readonly href = signal<string | undefined>(undefined);
  readonly loadText = signal<
    (() => Observable<string | undefined>) | undefined
  >(undefined);
}

describe('QueryListItemComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function create(hover = true) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: hover })),
    );
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const item = () => el.querySelector('[data-testid="row"]') as HTMLElement;
    const hoverRow = async (on = true) => {
      item().dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave'));
      await fixture.whenStable();
    };
    return { fixture, el, item, hoverRow };
  }

  it('renders the type icon, title, date, subtitle and actions in one item, with no code editor', async () => {
    const { el, item, fixture } = await create();
    const row = item();
    expect(row.tagName.toLowerCase()).toBe('ion-item');
    expect(
      row.querySelector('sneat-datatug-query-type-icon[slot="start"]'),
    ).not.toBeNull();
    expect(
      row.querySelector('[data-testid="saved-query-orders"]')?.innerHTML.trim(),
    ).toBe('Orders by country');
    expect(row.querySelector('time')?.getAttribute('title')).toContain('Added');
    expect(row.querySelector('ion-label .subtitle')).not.toBeNull();
    expect(row.querySelector('.action')).not.toBeNull();
    // Ionic moves the host aria-label onto the item's inner button, so read the bound name from the component.
    const component = fixture.debugElement.query(
      By.directive(QueryListItemComponent),
    ).componentInstance as unknown as { accessibleName(): string };
    expect(component.accessibleName()).toMatch(
      /^Orders by country, SQL query\. Added /,
    );
    expect(el.querySelector('sneat-datatug-sql')).toBeNull();
  });

  it('emits opened on click only when it has no link', async () => {
    const { fixture, item } = await create();
    item().click();
    expect(fixture.componentInstance.opened).toBe(1);
    fixture.componentInstance.href.set('/query/orders');
    fixture.detectChanges();
    await fixture.whenStable();
    item().click();
    expect(fixture.componentInstance.opened).toBe(1);
  });

  it('loads the text once, on first hover, and shows a highlighted preview', async () => {
    const { fixture, el, hoverRow } = await create();
    const load = vi.fn(() => of('SELECT id\nFROM orders'));
    fixture.componentInstance.loadText.set(load);
    fixture.detectChanges();
    expect(load).not.toHaveBeenCalled();
    await hoverRow();
    const preview = el.querySelector('[data-testid="query-preview"]');
    expect(preview?.getAttribute('role')).toBe('tooltip');
    expect(preview?.querySelector('.tugql-token-keyword')?.innerHTML).toBe(
      'SELECT',
    );
    expect(el.querySelector('ion-item')?.getAttribute('aria-describedby')).toBe(
      preview?.id,
    );
    await hoverRow(false);
    expect(el.querySelector('[data-testid="query-preview"]')).toBeNull();
    await hoverRow();
    expect(load).toHaveBeenCalledOnce();
  });

  it('shows nothing when the text is empty or the load fails', async () => {
    const empty = await create();
    empty.fixture.componentInstance.loadText.set(() => of('   '));
    empty.fixture.detectChanges();
    await empty.hoverRow();
    expect(empty.el.querySelector('[data-testid="query-preview"]')).toBeNull();

    TestBed.resetTestingModule();
    const failing = await create();
    failing.fixture.componentInstance.loadText.set(() =>
      throwError(() => new Error('offline')),
    );
    failing.fixture.detectChanges();
    await failing.hoverRow();
    expect(
      failing.el.querySelector('[data-testid="query-preview"]'),
    ).toBeNull();
  });

  it('never previews on a device that cannot hover', async () => {
    const { fixture, el, hoverRow } = await create(false);
    const pending = new Subject<string>();
    const load = vi.fn(() => pending);
    fixture.componentInstance.loadText.set(load);
    fixture.detectChanges();
    await hoverRow();
    expect(load).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="query-preview"]')).toBeNull();
  });
});
