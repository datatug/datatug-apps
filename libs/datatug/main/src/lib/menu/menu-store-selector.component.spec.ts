import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';

import { IDatatugUser } from '../models/interfaces';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { MenuStoreSelectorComponent } from './menu-store-selector.component';

describe('MenuStoreSelectorComponent', () => {
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
