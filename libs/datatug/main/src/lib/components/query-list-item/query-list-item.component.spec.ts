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

@Component({
  imports: [QueryListItemComponent],
  template: `
    <sneat-datatug-query-list-item
      queryTitle="Top customers"
      type="TugQL"
      href="/q/top"
      lines="none"
      optionId="box-o-0"
      highlight="cust"
      [detail]="false"
      [optionActive]="active()"
      (activated)="activations.set(activations() + 1)"
      ><span queryRowSubtitle class="secondary"
        >Query · reports</span
      ></sneat-datatug-query-list-item
    >
  `,
})
class OptionHostComponent {
  readonly active = signal(false);
  readonly activations = signal(0);
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
    const { el, item, main, preview, settle, setLoader } = await create();
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
    const subtitleId = el.querySelector('.query-row-subtitle')?.id;
    expect(main().getAttribute('aria-describedby')).toBe(
      `${subtitleId} ${preview()?.id}`,
    );
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
    // Only the subtitle still describes the row.
    expect(main().getAttribute('aria-describedby')).toBe(
      main().querySelector('.query-row-subtitle')?.id,
    );
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

  it('acts as a combobox option that never takes focus, and marks search hits', async () => {
    await TestBed.configureTestingModule({
      imports: [OptionHostComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OptionHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const option = el.querySelector('a.query-row-main') as HTMLElement;
    expect(option.id).toBe('box-o-0');
    expect(option.getAttribute('role')).toBe('option');
    expect(option.getAttribute('tabindex')).toBe('-1');
    expect(option.getAttribute('aria-selected')).toBe('false');
    expect(option.querySelector('mark')?.textContent).toBe('cust');
    expect(el.querySelector('.query-type-badge')?.textContent?.trim()).toBe(
      'TugQL',
    );
    expect(el.querySelector('.query-row-chevron')).toBeNull();
    expect(el.querySelector('ion-item')?.getAttribute('lines')).toBe('none');
    fixture.componentInstance.active.set(true);
    await fixture.whenStable();
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('ion-item')?.classList).toContain(
      'query-list-item-active',
    );
    // A press keeps focus in the search field; activation is reported so the popup can close.
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    option.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    option.click();
    expect(fixture.componentInstance.activations()).toBe(1);
  });

  it('describes a combobox option by its secondary line, which its accessible name replaces', async () => {
    await TestBed.configureTestingModule({
      imports: [OptionHostComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OptionHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const option = el.querySelector('[role="option"]') as HTMLElement;
    expect(option.getAttribute('aria-label')).toBe(
      'Top customers, TugQL query',
    );
    const ids = option.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toHaveLength(1);
    const description = ids
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(' ');
    expect(description).toBe('Query · reports');
    // The described element lives inside the option, so it is announced with it.
    expect(option.contains(document.getElementById(ids[0]))).toBe(true);
  });

  it('hides the empty subtitle wrapper when nothing is projected', async () => {
    @Component({
      imports: [QueryListItemComponent],
      template: `<sneat-datatug-query-list-item queryTitle="Bare" />`,
    })
    class BareHostComponent {}
    TestBed.configureTestingModule({
      imports: [BareHostComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
      ],
    });
    const fixture = TestBed.createComponent(BareHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const subtitle = el.querySelector('.query-row-subtitle') as HTMLElement;
    // The empty wrapper is hidden and describes nothing.
    expect(subtitle.textContent?.trim()).toBe('');
    expect(subtitle.matches(':empty')).toBe(true);
  });

  it('is a plain list row (no option role) without optionId', async () => {
    const { el } = await create();
    const main = el.querySelector('.query-row-main') as HTMLElement;
    expect(main.hasAttribute('role')).toBe(false);
    expect(main.hasAttribute('tabindex')).toBe(false);
    expect(main.hasAttribute('aria-selected')).toBe(false);
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    main.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
  });
});
