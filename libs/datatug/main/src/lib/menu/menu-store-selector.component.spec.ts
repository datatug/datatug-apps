import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';

import { IDatatugUser } from '../models/interfaces';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { MenuStoreSelectorComponent } from './menu-store-selector.component';

describe('MenuStoreSelectorComponent', () => {
  it('keeps the routed project store selected before and after store metadata loads', async () => {
    const storeId = 'http-127.0.0.1:18989';
    const currentStoreId = new BehaviorSubject<string | undefined>(storeId);
    const goStore = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuStoreSelectorComponent],
      providers: [
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        { provide: DatatugNavContextService, useValue: { currentStoreId } },
        { provide: DatatugNavService, useValue: { goStore } },
      ],
    })
      .overrideComponent(MenuStoreSelectorComponent, {
        set: { imports: [], template: '', schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(MenuStoreSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      title: 'Test user',
      datatug: {
        stores: { 'github.com': { type: 'github', title: 'GitHub' } },
      },
    } as IDatatugUser);
    fixture.detectChanges();

    expect(fixture.componentInstance.currentStoreId()).toBe(storeId);
    expect(fixture.componentInstance.stores()).toContainEqual(
      expect.objectContaining({ id: storeId, title: 'http://127.0.0.1:18989' }),
    );

    fixture.componentRef.setInput('datatugUser', {
      title: 'Test user',
      datatug: {
        stores: { [storeId]: { type: 'agent', title: 'My local agent' } },
      },
    } as IDatatugUser);
    fixture.detectChanges();
    expect(
      fixture.componentInstance.stores()?.filter((s) => s.id === storeId),
    ).toEqual([
      expect.objectContaining({ id: storeId, title: 'My local agent' }),
    ]);

    const nextStoreId = 'http-127.0.0.1:19000';
    currentStoreId.next(nextStoreId);
    fixture.detectChanges();
    expect(fixture.componentInstance.currentStoreId()).toBe(nextStoreId);
    expect(fixture.componentInstance.stores()).toContainEqual(
      expect.objectContaining({
        id: nextStoreId,
        title: 'http://127.0.0.1:19000',
      }),
    );
    expect(goStore).not.toHaveBeenCalled();

    currentStoreId.next('unsupported-store');
    fixture.detectChanges();
    expect(() => fixture.componentInstance.stores()).not.toThrow();
    expect(fixture.componentInstance.stores()).toContainEqual(
      expect.objectContaining({ id: 'github.com' }),
    );
  });

  it('navigates to the selected store so its projects can be browsed', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>(
      'github.com',
    );
    const goStore = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuStoreSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugNavContextService, useValue: { currentStoreId } },
        { provide: DatatugNavService, useValue: { goStore } },
      ],
    })
      .overrideComponent(MenuStoreSelectorComponent, {
        set: { imports: [], template: '', schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(MenuStoreSelectorComponent);
    const user = {
      title: 'Test user',
      datatug: {
        stores: {
          'github.com': { type: 'github', title: 'GitHub' },
          firestore: { type: 'firestore', title: 'Cloud' },
        },
      },
    } as IDatatugUser;
    fixture.componentRef.setInput('datatugUser', user);
    fixture.detectChanges();

    fixture.componentInstance.switchStore({
      detail: { value: 'firestore' },
    } as CustomEvent);

    expect(goStore).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { type: 'firestore' },
        brief: expect.objectContaining({ id: 'firestore' }),
      }),
    );
  });
});
