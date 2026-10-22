import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
    expect(details?.textContent).toMatch(/Reference/);
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
});
