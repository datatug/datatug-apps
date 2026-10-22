import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent', () => {
  function render(setup: (c: ErrorStateComponent) => void) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ErrorStateComponent);
    setup(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

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
    expect(details?.textContent).toMatch(/Reference/);
  });

  it('offers one explicit link and no Retry when told so', () => {
    const el = render(() => undefined);
    expect(el.querySelector('details')).toBeNull();
    expect(el.querySelectorAll('ion-button').length).toBe(0);
  });
});
