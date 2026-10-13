import { Provider } from '@angular/core';
import { Router } from '@angular/router';
import { SneatApiBaseUrl } from '@sneat/api';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import {
  SUBSCRIPTION_RECOVERY,
  SubscriptionRecoveryPort,
  SubscriptionRecoveryItem,
} from '@sneat/components';
import { appCheckoutAuth } from './checkout-auth';
import { checkoutApi } from './checkout-api.mjs';
import { checkoutRail } from './checkout-config.mjs';

export function purchaseRecoveryPort(
  authState: SneatAuthStateService,
  users: SneatUserService,
  router: Router,
  normalOrigin: string,
): SubscriptionRecoveryPort {
  const auth = appCheckoutAuth(
    authState,
    users,
    router,
    '/subscribe?plan=pro&period=monthly',
  );
  return {
    observeIdentity(callback) {
      return auth.observe((user) => callback(user?.id ?? null));
    },
    async load(mode, after) {
      const rail = checkoutRail(
        `plan=pro&period=monthly${mode === 'test' ? '&checkout=test' : ''}`,
        false,
        normalOrigin,
      );
      if (!rail || rail.mode !== mode) throw new Error('Invalid recovery rail');
      const page = (await checkoutApi(rail, auth).purchases(after)) as {
        items?: unknown;
        next?: unknown;
      };
      if (
        !Array.isArray(page.items) ||
        page.items.length > 50 ||
        (page.next !== undefined &&
          (typeof page.next !== 'string' ||
            !/^billing_[A-Za-z0-9_-]{1,128}$/.test(page.next)))
      )
        throw new Error('Invalid recovery page');
      const items = page.items.map((item): SubscriptionRecoveryItem => {
        const prefix =
          mode === 'test'
            ? /^cs_test_[A-Za-z0-9_]+$/
            : /^cs_live_[A-Za-z0-9_]+$/;
        if (
          !item ||
          typeof item.accountId !== 'string' ||
          typeof item.sessionId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(item.accountId) ||
          !prefix.test(item.sessionId) ||
          ![
            'datatug-business-usage-monthly',
            'datatug-business-usage-annual',
          ].includes(item.planId) ||
          !['setup_required', 'check_status'].includes(item.state)
        )
          throw new Error('Invalid recovery item');
        const hasDetails = item.purchasedAtUTC !== undefined;
        if (
          hasDetails &&
          (typeof item.purchasedAtUTC !== 'string' ||
            !Number.isFinite(Date.parse(item.purchasedAtUTC)) ||
            typeof item.currency !== 'string' ||
            !/^[a-zA-Z]{3}$/.test(item.currency) ||
            !Number.isSafeInteger(item.amountPaidMinor) ||
            item.amountPaidMinor < 0 ||
            (item.spaceReference !== undefined &&
              (typeof item.spaceReference !== 'string' ||
                !/^[A-Za-z0-9_-]{1,128}$/.test(item.spaceReference))))
        ) {
          throw new Error('Invalid recovery details');
        }
        const description = hasDetails
          ? [
              new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
              }).format(new Date(item.purchasedAtUTC)),
              `${new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency.toUpperCase() }).format(item.amountPaidMinor / 100)} paid`,
              ...(item.spaceReference
                ? [`Intended space: ${item.spaceReference}`]
                : []),
              `Reference ${item.accountId.slice(-8)}`,
            ].join(' · ')
          : `Purchase reference ${item.accountId}`;
        return {
          id: item.accountId,
          description,
          label: `DataTug Business · ${item.planId.endsWith('annual') ? 'Yearly' : 'Monthly'}`,
          action:
            item.state === 'setup_required'
              ? 'Finish Business setup'
              : 'Check purchase status',
          path: '/pricing/return',
          query: { mode, session_id: item.sessionId },
        };
      });
      return { items, ...(page.next ? { next: String(page.next) } : {}) };
    },
  };
}
export function provideCheckoutPurchaseRecovery(): Provider {
  return {
    provide: SUBSCRIPTION_RECOVERY,
    useFactory: purchaseRecoveryPort,
    deps: [SneatAuthStateService, SneatUserService, Router, SneatApiBaseUrl],
  };
}
