import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUERY_PREVIEW_HOVER_DELAY_MS,
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
      (opened)="opened.set(opened() + 1)"
    >
      <span queryRowSubtitle class="subtitle">Folder: sales/</span>
      <button queryRowActions slot="end" class="action" type="button">
        Run
      </button>
    </sneat-datatug-query-list-item>
  `,
})
class HostComponent {
  readonly opened = signal(0);
  readonly href = signal<string | undefined>(undefined);
  readonly loadText = signal<
    (() => Observable<string | undefined>) | undefined
  >(undefined);
}

describe('QueryListItemComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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
    const main = () => el.querySelector('.query-row-main') as HTMLElement;
    const preview = () => el.querySelector('[data-testid="query-preview"]');
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const setLoader = async (load: () => Observable<string | undefined>) => {
      fixture.componentInstance.loadText.set(load);
      await settle();
    };
    return { fixture, el, item, main, preview, settle, setLoader };
  }

  it('renders the icon, title, date and subtitle inside one main button, with actions beside it, not nested', async () => {
    const { el, item, main } = await create();
    const row = item();
    expect(row.tagName.toLowerCase()).toBe('ion-item');
    expect(row.hasAttribute('button')).toBe(false);
    const button = main();
    expect(button.tagName.toLowerCase()).toBe('button');
    expect(
      button.querySelector('sneat-datatug-query-type-icon'),
    ).not.toBeNull();
    expect(
      button
        .querySelector('[data-testid="saved-query-orders"]')
        ?.innerHTML.trim(),
    ).toBe('Orders by country');
    expect(button.querySelector('time')?.getAttribute('title')).toContain(
      'Added',
    );
    expect(button.querySelector('.subtitle')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toMatch(
      /^Orders by country, SQL query\. Added /,
    );
    // The action is a sibling of the main button, never inside it.
    const action = row.querySelector('.action');
    expect(action).not.toBeNull();
    expect(button.contains(action)).toBe(false);
    expect(el.querySelector('sneat-datatug-sql')).toBeNull();
  });

  it('emits opened from its button, and renders a link instead when it has an href', async () => {
    const { fixture, main, settle } = await create();
    main().click();
    expect(fixture.componentInstance.opened()).toBe(1);
    fixture.componentInstance.href.set('/query/orders');
    await settle();
    expect(main().tagName.toLowerCase()).toBe('a');
    expect(main().getAttribute('href')).toBe('/query/orders');
    main().click();
    expect(fixture.componentInstance.opened()).toBe(1);
  });

  it('waits for hover intent, loads once, and shows a highlighted preview described by the focusable element', async () => {
    const { item, main, preview, settle, setLoader } = await create();
    const load = vi.fn(() => of('SELECT id\nFROM orders'));
    await setLoader(load);
    vi.useFakeTimers();
    item().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(QUERY_PREVIEW_HOVER_DELAY_MS - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(preview()?.getAttribute('role')).toBe('tooltip');
    expect(preview()?.querySelector('.tugql-token-keyword')?.innerHTML).toBe(
      'SELECT',
    );
    expect(main().getAttribute('aria-describedby')).toBe(preview()?.id);
    item().dispatchEvent(new MouseEvent('mouseleave'));
    await settle();
    expect(preview()).toBeNull();
  });

  it('cancels a pending hover when the pointer leaves before the delay', async () => {
    const { item, setLoader } = await create();
    const load = vi.fn(() => of('select 1'));
    await setLoader(load);
    vi.useFakeTimers();
    item().dispatchEvent(new MouseEvent('mouseenter'));
    item().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(QUERY_PREVIEW_HOVER_DELAY_MS * 2);
    expect(load).not.toHaveBeenCalled();
  });

  it('cancels an in-flight load on blur', async () => {
    const { main, setLoader } = await create();
    const pending = new Subject<string>();
    await setLoader(() => pending);
    main().dispatchEvent(new FocusEvent('focus'));
    expect(pending.observed).toBe(true);
    main().dispatchEvent(new FocusEvent('blur'));
    expect(pending.observed).toBe(false);
  });

  it('shows the preview on keyboard focus and hides it on Escape', async () => {
    const { main, preview, settle, setLoader } = await create();
    await setLoader(() => of('select 1'));
    main().dispatchEvent(new FocusEvent('focus'));
    await settle();
    expect(preview()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(preview()).toBeNull();
    expect(main().hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows nothing when the text is empty or the load fails', async () => {
    const empty = await create();
    await empty.setLoader(() => of('   '));
    empty.main().dispatchEvent(new FocusEvent('focus'));
    await empty.settle();
    expect(empty.preview()).toBeNull();

    TestBed.resetTestingModule();
    const failing = await create();
    await failing.setLoader(() => throwError(() => new Error('offline')));
    failing.main().dispatchEvent(new FocusEvent('focus'));
    await failing.settle();
    expect(failing.preview()).toBeNull();
  });

  it('never previews on a device that cannot hover', async () => {
    const { item, main, preview, setLoader } = await create(false);
    const load = vi.fn(() => of('select 1'));
    await setLoader(load);
    vi.useFakeTimers();
    item().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(QUERY_PREVIEW_HOVER_DELAY_MS * 2);
    main().dispatchEvent(new FocusEvent('focus'));
    expect(load).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
  });
});
