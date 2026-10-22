import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { markReported } from '@datatug/friendly-error';
import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent', () => {
  it('shows words, never the raw error, and keeps details collapsed with a reference', () => {
    const fixture = TestBed.configureTestingModule({
      providers: [provideRouter([])],
    }).createComponent(ErrorStateComponent);
    fixture.componentRef.setInput('what', 'this board');
    fixture.componentRef.setInput(
      'error',
      new Error('GET https://x.example/a?token=abc123 failed at undefined'),
    );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h2')?.textContent?.trim()).toBeTruthy();
    expect(el.textContent).not.toMatch(/token=|https?:|undefined/i);
    const details = el.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toMatch(/Code APP/);
  });

  it('renders explicit words with one link and no Retry or Details', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ErrorStateComponent);
    fixture.componentRef.setInput('title', 'This page does not exist');
    fixture.componentRef.setInput('hint', 'Start again.');
    fixture.componentRef.setInput('retryable', false);
    fixture.componentRef.setInput('links', [{ label: 'Go home', href: '/' }]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h2')?.textContent).toContain('does not exist');
    expect(el.querySelector('details')).toBeNull();
    const buttons = el.querySelectorAll('ion-button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Go home');
  });

  function create(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ErrorStateComponent);
    for (const [name, value] of Object.entries(inputs))
      fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('is one alert for a page and a polite status for a section', () => {
    const page = create({ error: { status: 503 } });
    expect(page.querySelector('[role="alert"]')).toBeTruthy();
    expect(page.querySelector('section')?.getAttribute('role')).toBeNull();
    TestBed.resetTestingModule();
    const section = create({ error: { status: 503 }, compact: true });
    expect(section.querySelector('section')?.getAttribute('role')).toBe(
      'status',
    );
    expect(section.querySelector('section')?.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(section.querySelector('[role="alert"]')).toBeNull();
  });

  it('offers Sign in, not a Retry that cannot help, for a missing sign-in', () => {
    const el = create({ error: { status: 401 } });
    const labels = Array.from(el.querySelectorAll('ion-button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain('Sign in');
    expect(labels).not.toContain('Retry');
  });

  it('shows the reference only when the failure was reported', () => {
    const error = new TypeError('boom');
    const unreported = create({ error });
    expect(unreported.querySelector('details')?.textContent).not.toMatch(
      /Reference/,
    );
    markReported(error);
    TestBed.resetTestingModule();
    const reported = create({ error });
    expect(reported.querySelector('details')?.textContent).toMatch(
      /Reference [0-9a-f]{8}/,
    );
  });
});
