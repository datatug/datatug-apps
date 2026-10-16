import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { LinkProblemComponent } from '../link-problem/link-problem.component';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SavedResultBannerComponent,
  SavedResultBannerState,
} from './saved-result-banner.component';
import { PROMPT_TEXT } from './query-result.spec-helper';

const shown = (
  overrides: Partial<Extract<SavedResultBannerState, { kind: 'shown' }>> = {},
): SavedResultBannerState => ({
  kind: 'shown',
  mode: 'draft',
  savedAt: '2026-10-16T08:00:00Z',
  rowsKept: 2,
  hasMore: false,
  summary: ['Kind: dtql', 'Rows: 2 saved'],
  skippedParameters: [],
  ...overrides,
});

function mount(state: SavedResultBannerState) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(SavedResultBannerComponent);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('storeId', 'http-127.0.0.1:8989');
  fixture.componentRef.setInput('resultId', 'rid-1');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`);
  return { fixture, el, q };
}

describe('SavedResultBannerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says the rows are a saved result, from when, how many, and links the other views', () => {
    const { q } = mount(shown({ hasMore: true }));
    expect(q('saved-result-badge')?.textContent).toContain(
      `Saved result from ${new Date('2026-10-16T08:00:00Z').toLocaleString()}`,
    );
    expect(q('saved-result-rows')?.textContent).toMatch(
      /2 rows\s+· more rows exist/,
    );
    expect(q('saved-result-draft-hint')?.textContent).toContain(
      'save the query to run it again',
    );
    const record = q('saved-result-view-record') as HTMLAnchorElement;
    expect(record.getAttribute('href')).toBe(
      '/store/http-127.0.0.1:8989/result/rid-1?view=record',
    );
    for (const v of ['columns', 'sources', 'related']) {
      expect(q(`saved-result-view-${v}`)).not.toBeNull();
    }
    expect(q('saved-result-view-table')).toBeNull();
  });

  it('keeps an unreadable time as it is', () => {
    const { q } = mount(shown({ savedAt: 'yesterday' }));
    expect(q('saved-result-badge')?.textContent).toContain(
      'Saved result from yesterday',
    );
  });

  it('shows the prompt in a collapsible section, as text only', () => {
    const { q, el } = mount(
      shown({ prompt: { text: PROMPT_TEXT, truncated: false } }),
    );
    const details = q('saved-result-prompt') as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.querySelector('summary')?.textContent).toBe('Prompt');
    expect(q('saved-result-prompt-text')?.textContent).toBe(PROMPT_TEXT);
    // the markup in the prompt is text: no element was built from it
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('#x')).toBeNull();
    expect(q('saved-result-prompt-truncated')).toBeNull();
  });

  it('marks a prompt that was cut short', () => {
    const { q } = mount(shown({ prompt: { text: 'abc', truncated: true } }));
    expect(q('saved-result-prompt-truncated')?.textContent).toContain(
      'cut short',
    );
  });

  it('has no prompt section without a prompt', () => {
    const { q } = mount(shown());
    expect(q('saved-result-prompt')).toBeNull();
    expect(q('saved-result-draft-hint')).not.toBeNull();
  });

  it('names why the editor is empty and lists the saved query read-only', () => {
    const { q } = mount(
      shown({
        mode: 'rows-only',
        notice: 'This result was saved by an older DataTug.',
        summary: ['Kind: dtql', 'Database: chinook in environment local'],
      }),
    );
    expect(q('saved-result-notice')?.textContent).toContain('older DataTug');
    expect(q('saved-result-summary')?.textContent).toContain(
      'Database: chinook in environment local',
    );
    expect(q('saved-result-draft-hint')).toBeNull();
  });

  it('names the list parameters it did not restore, never their values', () => {
    const { q } = mount(shown({ skippedParameters: ['Countries'] }));
    expect(q('saved-result-skipped')?.textContent).toContain('Countries');
  });

  it('says it is loading', () => {
    const { q } = mount({ kind: 'loading' });
    expect(q('saved-result-loading')).not.toBeNull();
    expect(q('saved-result-banner')).toBeNull();
  });

  it('shows a problem by name and lets the person check again', () => {
    const { fixture, el } = mount({ kind: 'problem', problem: 'link-expired' });
    let checked = 0;
    fixture.componentInstance.checkAgain.subscribe(() => checked++);
    expect(el.querySelector('sneat-datatug-link-problem')).not.toBeNull();
    fixture.debugElement
      .query(By.directive(LinkProblemComponent))
      .componentInstance.checkAgain.emit();
    expect(checked).toBe(1);
    expect(el.textContent).not.toContain('Saved result from');
  });
});
