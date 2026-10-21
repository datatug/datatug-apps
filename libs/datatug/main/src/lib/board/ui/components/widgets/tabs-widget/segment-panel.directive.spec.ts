import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SegmentPanelDirective } from './segment-panel.directive';

@Component({ imports: [SegmentPanelDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA], template: '<ion-segment-button [sneatSegmentPanel]="panel" [panelSelected]="selected()"/><div #panel></div>' })
class Harness { readonly selected = signal(false); }

describe('SegmentPanelDirective', () => {
  async function setup(supported = true) {
    const fixture = TestBed.createComponent(Harness);
    const host = fixture.nativeElement.querySelector('ion-segment-button') as HTMLElement & { componentOnReady: () => Promise<void> };
    const button = document.createElement('button');
    button.setAttribute('part', 'native');
    if (supported) Object.defineProperty(button, 'ariaControlsElements', { value: null, writable: true });
    (host.shadowRoot ?? host.attachShadow({ mode: 'open' })).replaceChildren(button);
    const pending: (() => void)[] = [];
    host.componentOnReady = () => new Promise<void>(resolve => { pending.push(resolve); });
    fixture.detectChanges();
    await Promise.resolve();
    return { fixture, button, host, ready: () => pending.shift()?.(), panel: fixture.nativeElement.querySelector('div') as HTMLElement };
  }
  it('waits for the public ready contract and associates the native tab with the actual panel', async () => {
    const { fixture, button, panel, ready } = await setup();
    expect(button.ariaControlsElements).toBeNull();
    ready();
    await fixture.whenStable();
    expect(button.ariaControlsElements).toEqual([panel]);
  });
  it('ignores an obsolete selection readiness before applying the current relationship', async () => {
    const { fixture, button, panel, ready } = await setup();
    fixture.componentInstance.selected.set(true);
    fixture.detectChanges();
    ready();
    await Promise.resolve();
    expect(button.ariaControlsElements).toBeNull();
    ready();
    await fixture.whenStable();
    expect(button.ariaControlsElements).toEqual([panel]);
  });
  it('ignores readiness after destruction', async () => {
    const { fixture, button, ready } = await setup();
    fixture.destroy();
    ready();
    await Promise.resolve();
    expect(button.ariaControlsElements).toBeNull();
  });
  it('does not fabricate support in older engines', async () => {
    const { fixture, button, ready } = await setup(false);
    ready();
    await fixture.whenStable();
    expect(Object.hasOwn(button, 'ariaControlsElements')).toBe(false);
  });
});
