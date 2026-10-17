import { InjectionToken } from '@angular/core';

/**
 * True only in the Business project preview build (environment.business-preview.ts).
 * When true, every checkout rail selects TEST and never LIVE, whatever the query
 * string says. It defaults to false, so production behaviour is unchanged.
 */
export const DATATUG_CHECKOUT_FORCE_TEST = new InjectionToken<boolean>(
  'DATATUG_CHECKOUT_FORCE_TEST',
  {
    providedIn: 'root',
    factory: () => false,
  },
);
