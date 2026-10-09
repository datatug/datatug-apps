import type { Router } from '@angular/router';
import {
  isSneatAccountReady,
  type ISneatAuthState,
  type ISneatUserState,
  type SneatAuthStateService,
  type SneatUserService,
} from '@sneat/auth-core';
import type { CheckoutAuth } from './checkout-contracts';
import { combineLatest } from 'rxjs';

/** Uses the host's existing identity. Tokens stay only at the request boundary. */
export function appCheckoutAuth(
  auth: SneatAuthStateService,
  userService: SneatUserService,
  router: Router,
  returnPath: string,
  continuationLabel = 'DataTug Pro',
): CheckoutAuth {
  const proPath =
    /^\/(?:subscribe\?plan=pro&period=(?:monthly|yearly)(?:&checkout=test)?|pricing\/return\?mode=(?:test|live)&session_id=cs_(?:test_|live_)?[A-Za-z0-9_]+)$/;
  const businessPath =
    /^\/(?:business\/checkout\?planID=datatug-business-usage-(?:monthly|annual)(?:&spaceID=[A-Za-z0-9_-]{1,128})?|business\/checkout\/return\?spaceID=[A-Za-z0-9_-]{1,128}&session_id=cs_test_[A-Za-z0-9_]+)$/;
  if (!proPath.test(returnPath) && !businessPath.test(returnPath)) {
    throw new Error('Invalid checkout continuation');
  }
  let latestAuthState: ISneatAuthState | undefined;
  let latestUserState: ISneatUserState | undefined;
  return {
    observe(callback) {
      let sawSettledAuth = false;
      const subscription = combineLatest([
        auth.authState,
        userService.userState,
      ]).subscribe(([authState, userState]) => {
        latestAuthState = authState;
        latestUserState = userState;
        if (
          authState.status === 'authenticating' &&
          authState.loadingPhase !== 'failed' &&
          !sawSettledAuth
        )
          return;
        if (authState.status !== 'authenticating') sawSettledAuth = true;

        const user = isSneatAccountReady(authState, userState)
          ? authState.user
          : null;
        callback(user ? { id: user.uid, email: user.email } : null);
      });
      return () => subscription.unsubscribe();
    },
    async token() {
      const user = auth.fbAuth.currentUser;
      const uid = user?.uid;
      if (
        !uid ||
        user?.isAnonymous ||
        latestAuthState?.user?.uid !== uid ||
        !isSneatAccountReady(latestAuthState, latestUserState)
      ) {
        return null;
      }
      const token = await user.getIdToken();
      if (
        auth.fbAuth.currentUser?.uid !== uid ||
        auth.fbAuth.currentUser?.isAnonymous !== false ||
        latestAuthState?.user?.uid !== uid ||
        !isSneatAccountReady(latestAuthState, latestUserState)
      ) {
        return null;
      }
      return token;
    },
    async signIn() {
      await router.navigate(['/login'], {
        fragment: returnPath,
        queryParams: {
          reason: `Sign in to continue with ${continuationLabel}`,
        },
      });
    },
    async signOut() {
      await auth.signOut();
    },
  };
}
