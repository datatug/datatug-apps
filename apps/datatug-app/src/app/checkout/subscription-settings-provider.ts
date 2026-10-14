import { Provider } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { SneatApiBaseUrl } from '@sneat/api';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import {
  SUBSCRIPTION_SETTINGS,
  SubscriptionSettingsPort,
  ManagedSubscription,
} from '@sneat/components';
import { appCheckoutAuth } from './checkout-auth';
import { checkoutRail } from './checkout-config.mjs';
import { checkoutApi } from './checkout-api.mjs';
import { manageableBusinessSpaces } from './business-checkout-spaces';

export function managedSubscription(
  value: unknown,
  mode: 'test' | 'live',
  spaces: Record<string, { title?: string }> = {},
): ManagedSubscription {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid subscription');
  const item = value as ManagedSubscription;
  const personal = ['datatug-pro-monthly', 'datatug-pro-annual'].includes(
    item.planId,
  );
  const business = [
    'datatug-business-usage-monthly',
    'datatug-business-usage-annual',
  ].includes(item.planId);
  if (
    typeof item.accountId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(item.accountId) ||
    !(personal || business) ||
    item.kind !== (personal ? 'personal' : 'organisation') ||
    (item.spaceID !== undefined &&
      (typeof item.spaceID !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.spaceID))) ||
    ![
      'active',
      'ended',
      'refunded',
      'cancellation_scheduled',
      'setup_required',
      'check_status',
    ].includes(item.status) ||
    ![item.paidThroughUTC, item.scheduledEndUTC, item.firstPaidUTC].every(
      (date) => typeof date === 'string' && Number.isFinite(Date.parse(date)),
    ) ||
    ![
      item.regularMinor,
      item.renewalMinor,
      item.bindingRevision,
      item.discountPercent,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    item.discountPercent >= 100 ||
    ![
      item.priceConfirmed,
      item.launchDiscount,
      item.canCancel,
      item.canTransfer,
    ].every((v) => typeof v === 'boolean') ||
    (item.priceConfirmed &&
      (typeof item.currency !== 'string' ||
        !/^[a-zA-Z]{3}$/.test(item.currency))) ||
    (item.sessionId !== undefined &&
      !(
        mode === 'test' ? /^cs_test_[A-Za-z0-9_]+$/ : /^cs_live_[A-Za-z0-9_]+$/
      ).test(item.sessionId)) ||
    (personal && item.canTransfer)
  )
    throw new Error('Invalid subscription');
  return {
    ...item,
    currency: item.currency?.toUpperCase(),
    label: personal ? 'DataTug Pro' : 'DataTug Business',
    period: item.planId.endsWith('annual') ? 'year' : 'month',
    spaceTitle: item.spaceID
      ? spaces[item.spaceID]?.title?.trim() ||
        (personal ? 'Personal space' : `Space ${item.spaceID}`)
      : 'Finish setup',
  };
}

export function provideSubscriptionSettings(): Provider {
  return {
    provide: SUBSCRIPTION_SETTINGS,
    deps: [SneatAuthStateService, SneatUserService, Router, SneatApiBaseUrl],
    useFactory: (
      authState: SneatAuthStateService,
      users: SneatUserService,
      router: Router,
      origin: string,
    ): SubscriptionSettingsPort => {
      const state = toSignal(users.userState);
      const auth = appCheckoutAuth(
        authState,
        users,
        router,
        '/subscribe?plan=pro&period=monthly',
      );
      const api = (mode: 'live' | 'test') => {
        const rail = checkoutRail(
          `plan=pro&period=monthly${mode === 'test' ? '&checkout=test' : ''}`,
          false,
          origin,
        );
        if (!rail || rail.mode !== mode)
          throw new Error('Invalid subscription rail');
        return checkoutApi(rail, auth);
      };
      const map = (value: unknown, mode: 'live' | 'test') =>
        managedSubscription(value, mode, state()?.record?.spaces);
      return {
        observeIdentity(callback) {
          return auth.observe((user) => callback(user?.id ?? null));
        },
        async load(mode, after) {
          const page = await api(mode).subscriptions(after);
          if (
            !Array.isArray(page.items) ||
            page.items.length > 51 ||
            (page.next !== undefined &&
              (typeof page.next !== 'string' ||
                !/^billing_[A-Za-z0-9_-]{1,128}$/.test(page.next)))
          )
            throw new Error('Invalid subscription page');
          return {
            items: page.items.map((value: unknown) => map(value, mode)),
            ...(page.next ? { next: page.next } : {}),
          };
        },
        async read(mode, id) {
          const item = map(await api(mode).subscription(id), mode);
          if (item.accountId !== id) throw new Error('Invalid subscription');
          return item;
        },
        async cancel(mode, id) {
          const item = map(await api(mode).cancelSubscription(id), mode);
          if (item.accountId !== id) throw new Error('Invalid subscription');
          return item;
        },
        async transfer(mode, item, target, requestId) {
          if (
            !item.spaceID ||
            item.kind !== 'organisation' ||
            !item.canTransfer
          )
            throw new Error('Invalid subscription transfer');
          const result = await api(mode).transferSubscription({
            accountId: item.accountId,
            fromSpaceID: item.spaceID,
            spaceID: target,
            requestId,
            expectedRevision: item.bindingRevision,
          });
          if (
            result.accountId !== item.accountId ||
            result.spaceID !== target ||
            result.bindingRevision !== item.bindingRevision + 1
          )
            throw new Error('Transfer status requires a refresh');
        },
        spaces() {
          return manageableBusinessSpaces(state()?.record?.spaces).filter(
            (s) => s.type === 'company',
          );
        },
        resume(mode, item) {
          return item.sessionId &&
            ['setup_required', 'check_status'].includes(item.status)
            ? {
                path: '/pricing/return',
                query: { mode, session_id: item.sessionId },
              }
            : undefined;
        },
        message(error) {
          const code = (error as { code?: string })?.code;
          return (
            (
              {
                transfer_settlement_required:
                  'Current-period usage needs settlement before this subscription can be transferred. No access was moved.',
                already_active:
                  'That space already has a subscription or pending purchase. Choose another space.',
                binding_changed:
                  'This subscription changed. Refresh its details before trying again.',
                space_admin_required:
                  'Current billing and space administrator permissions are required.',
                cancellation_resolving:
                  'Cancellation status is still being checked. Retry to check the same subscription.',
                checkout_reconciliation_required:
                  'Check the payment status before managing this subscription.',
              } as Record<string, string>
            )[code ?? ''] ??
            'Your subscriptions could not be checked. Please retry.'
          );
        },
      };
    },
  };
}
