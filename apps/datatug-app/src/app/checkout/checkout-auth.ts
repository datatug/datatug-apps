import type { SneatAuthStateService } from '@sneat/auth-core';
import type { Router } from '@angular/router';
import type { CheckoutAuth } from './checkout-contracts';

/** Uses the host's existing identity. Tokens stay only at the request boundary. */
export function appCheckoutAuth(
  auth: SneatAuthStateService,
  router: Router,
  returnPath: string,
): CheckoutAuth {
  if (
    !/^\/(?:subscribe\?plan=pro&period=(?:monthly|yearly)(?:&checkout=test)?|pricing\/return\?mode=(?:test|live)&session_id=cs_(?:test_|live_)?[A-Za-z0-9_]+)$/.test(
      returnPath,
    )
  ) {
    throw new Error('Invalid checkout continuation');
  }
  return {
    observe(callback) {
      const subscription = auth.authState.subscribe((state) => {
        // Do not turn startup/token refresh into a signed-out flash or purchase.
        if (state.status === 'authenticating') return;
        const user =
          state.status === 'authenticated' && !state.user?.isAnonymous
            ? state.user
            : null;
        callback(user ? { id: user.uid, email: user.email } : null);
      });
      return () => subscription.unsubscribe();
    },
    async token() {
      const user = auth.fbAuth.currentUser;
      return user && !user.isAnonymous ? user.getIdToken() : null;
    },
    async signIn() {
      await router.navigate(['/login'], {
        fragment: returnPath,
        queryParams: { reason: 'Sign in to continue with DataTug Pro' },
      });
    },
    async signOut() {
      await auth.signOut();
    },
  };
}
