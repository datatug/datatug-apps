import { TestBed } from '@angular/core/testing';
import {
  setupAngularTestingEnvironment,
  setupGlobalMocks,
} from './base-test-setup';
import { ErrorLogger, AnalyticsService, SNEAT_FIREBASE_AUTH } from '@sneat/core';
import { Firestore } from 'firebase/firestore';

export function configureGlobalTestBed() {
  try {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: () => {
              return vi.fn();
            },
          },
        },
        {
          provide: Firestore,
          useValue: {
            type: 'Firestore',
            toJSON: () => ({}),
          },
        },
        {
          provide: SNEAT_FIREBASE_AUTH,
          useValue: {
            onIdTokenChanged: vi.fn(() => () => void 0),
            onAuthStateChanged: vi.fn(() => () => void 0),
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            logEvent: vi.fn(),
            identify: vi.fn(),
            loggedOut: vi.fn(),
            setCurrentScreen: vi.fn(),
          },
        },
      ],
    });
  } catch {
    // ignore
  }
}

export function setupTestEnvironment() {
  setupAngularTestingEnvironment();
  setupGlobalMocks();
  configureGlobalTestBed();
}
