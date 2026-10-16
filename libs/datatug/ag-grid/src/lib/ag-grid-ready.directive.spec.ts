import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgGridReadyDirective } from './ag-grid-ready.directive';
import * as setup from './ag-grid-setup';

@Component({
  imports: [AgGridReadyDirective],
  template: `<p id="host"><b *datatugAgGridReady id="grid">grid</b></p>`,
})
class HostComponent {}

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

describe('AgGridReadyDirective', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }),
  );

  it('creates the grid only after ensureAgGrid() resolved', async () => {
    let release: () => void = () => undefined;
    vi.spyOn(setup, 'ensureAgGrid').mockReturnValue(
      new Promise<void>((r) => (release = r)),
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#grid')).toBeNull();
    release();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#grid')).not.toBeNull();
  });

  it('creates nothing when destroyed before registration finished', async () => {
    let release: () => void = () => undefined;
    vi.spyOn(setup, 'ensureAgGrid').mockReturnValue(
      new Promise<void>((r) => (release = r)),
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    release();
    await Promise.resolve();
    expect(host.querySelector('#grid')).toBeNull();
  });
});
