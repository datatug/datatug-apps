---
format: https://specscore.md/plan-specification
status: Executing
---

# Plan: Shared checkout and independent space subscriptions

**Status:** Executing
**Source Feature:** checkout-journey
**Date:** 2026-10-12
**Owner:** alex
**Supersedes:** —

## Summary

Deliver the approved common Pro/Business purchase journey with independent payer and beneficiary ownership. Allow one buyer to retain Pro and pay for several Business spaces, while enforcing one active DataTug base subscription per space. Track shared settings and paid-access transfer as a coordinated follow-up that does not gate launch.

## Approach

Journey: pricing/deep link → separate sign-in page for unsigned users → signed-in subscription card and authoritative quote/payment → durable confirmation → personal completion or post-payment Business attachment → existing project/space home or optional project setup. Reuse the current Stripe adapter, auth panel, native idempotent Spaceus provisioning and Paymentus ownership/reconciliation; domain logic belongs in the owning extension, with host wiring only. Buyer identity is separate from the base-service destination fence. Preserve stable subscription/discount lineage through attachment and future transfer. No live payments or deployment-setting changes. The existing launch task owns shared management/transfer follow-up; this task supplies the checkout contract and reusable foundations.

## Tasks

### Task 1: Shared shell, summary and authentication context

**Status:** complete
**Verifies:** checkout-journey#ac:checkout-shell, checkout-journey#ac:price-summary, checkout-journey#ac:auth-return

Suppress the application panel across checkout and auth continuations without remounting the payment outlet. Share regular/discount/final summary, period vocabulary and annual promotion. Preserve period/test context on pricing Back and use existing Sneat authentication directly. Implemented locally with rendered shell, price and asynchronous route tests; see feature implementation evidence. Complete for this bounded task, not whole checkout acceptance or real authentication-return proof.

### Task 2: Durable Business purchase before space attachment

**Status:** complete
**Verifies:** checkout-journey#ac:business-after-payment, checkout-journey#ac:durable-attachment

Implemented and published in Paymentus backend v0.52.0 (PR #110), with host binding PR #1249. Add an owned Paymentus pending billing-account purchase contract with buyer authorization, server-mode isolation and stable idempotency. Keep optional space reference separate from billing ownership. Do not weaken existing space-service authorization or invent a dummy usable space. Persist confirmed paid-unlinked purchases independently of browser return. Reuse native request-ID-based provisioning after payment; atomically fence target base ownership and replay attachment safely.

### Task 3: Independent subscriptions and launch places

**Status:** in_progress
**Verifies:** checkout-journey#ac:multiple-space-ownership, checkout-journey#ac:independent-subscriptions, checkout-journey#ac:optional-pro-cancellation, checkout-journey#ac:introductory-usage

Paymentus ownership/refund/ledger tests and local shared checkout cancellation tests pass; real provider operations remain unverified. Verify existing per-space purchase and per-subscription discount fences for one buyer with Pro and multiple Business spaces. Preserve the paying identity and space recipient separately. Check same-space duplicate/retry, effective end, full refund and live/test isolation. Retain Pro unless the customer explicitly schedules end-of-term cancellation through a supported owned operation.

### Task 4: Local scenarios, recovery and publication

**Status:** in_progress
**Verifies:** checkout-journey#ac:scenario-coverage, checkout-journey#ac:recovery, checkout-journey#ac:rail-isolation, checkout-journey#ac:safari-proof

Local matrix: 30 Chromium/mobile WebKit cases pass with real emulator auth and fake payment HTTP, including all ten starting situations, Pro confirmation, Business setup, provider-loader failure/retry, expired return and mixed-rail rejection. Four further cases cover the existing Business subscription and referenced-space permission denial (34 cases total). The separate opt-in Playwright provider suite checks the deployed TEST catalog/preflights, an unpaid real provider form and an existing paid return without changing its space. The TEST root-filter fix is landed in host PR #1250, and its exact-source image is serving the dedicated TEST service with configuration/IAM preserved. The deployed catalog and shared session/setup/options preflights pass; authenticated provider form/return verification remains outstanding. The already allowed local origin is `http://datatug.localhost:4328`; 127.0.0.1:18787 remains a visual preview. No origin allowlist change is needed. Authenticated provider checks require the designated TEST buyer state outside Git and are explicitly skipped when absent. Record what is fixture-only, browser-observed or unverified. Run repository checks, self-review (Alex requested no additional agents), publish the resulting changes through WB, and record exact-head verification. Hold merges until checkout is ready; no intermediate landing. Physical Safari and real provider payment evidence must not be inferred from fixtures.

### Task 5: Coordinate management/transfer follow-up

**Status:** complete
**Verifies:** checkout-journey#ac:multiple-space-ownership

Coordinate with the DataTug Launch Epic’s `space-subscription-management` specification. Record paid-access-only transfer, unchanged projects, retained dates/discount/introductory history/usage and separate add-ons. Do not implement transfer settings or expand metered billing in the launch checkout task.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*


### Latest presentation direction, 12 October 2026

Unsigned users go to `/checkout/sign-in` with preserved validated checkout context and see only “Complete your DataTug {Pro|Business} subscription”, one Sneat.co sign-in sentence, and the reused AuthPanel. Subscription details appear only after account readiness at `/subscribe` or `/business/checkout`. Place the payment button and early-access acknowledgement in the same standard white Ionic subscription card. Keep the sidebar hidden across both URLs and callbacks. This supersedes the earlier combined summary/auth screen, including the earlier pre-auth price display. Guarantee wording covers both plans’ first base payment within 30 days; separate usage/prepaid/add-ons are excluded.

For an opaque payment return whose type is not yet known, use neutral “Complete your DataTug subscription” branding until authenticated status identifies Pro or Business. Do not guess Pro from missing selection parameters. This does not change a selected plan, price, payment rail or ownership.

## Approved checkout recovery and polish follow-up (2026-10-12)

Alex approved all five improvements. Journey: a buyer returns to My account after closing paid Business checkout → sees an unfinished purchase → opens its existing paid return → selects/creates a business space → activates once → opens that space. Nothing in recovery creates a new payment session. Delayed or stale financial evidence is labeled as requiring a status check; refunded, expired, linked, foreign-buyer and other-mode records cannot offer fresh paid access. Paging and retry preserve the selected rail and discard results after an identity change.

1. Paymentus supplies a bounded, authenticated, buyer-home-scoped read-only recovery list. `/my` shows its reusable recovery card; Finish later returns there in the same mode. Existing return reconciliation and idempotent attachment remain authoritative.
2. Shared Pro/Business price summary shows Due today and renewal terms from the authoritative quote. Display the paid-term start before payment and after payment; no invented renewal dates. Temporary invitation discounts disclose their later rate.
3. Standard Ionic cards/controls present Business attachment, success and optional Pro period-end cancellation. Keep the activation action primary and cancellation separate and optional.
4. Unattended TEST provider authentication uses normal dedicated-account password sign-in from explicitly supplied private credentials. Verify the expected Firebase project and buyer identity before forwarding checkout requests. No admin impersonation, persistent auth artifacts, trace/video/password logs, LIVE fallback or automatic payment submission. Real payments remain a separate explicit opt-in.
5. Restore the browser title on checkout exit/re-entry; the shared Telegram auth widget cancels subscriptions/timers and ignores late async callbacks after destruction. Regressions cover deferred loader/nonce completion and cached Ionic route lifecycle.

Verification: component tests for account recovery/identity/mode/paging, price terms and title lifecycle; Paymentus authorization/refund/expiry/stale/paging tests; host TEST-route boundary tests; Telegram delayed teardown regressions; browser account→existing paid return→space activation→account recovery removed, without another session or payment. Existing ten-scenario checkout suite remains in CI. Real TEST execution is only claimed when configured private credentials are available and the opt-in suite actually runs.

#### Follow-up verification and delivery

The recovery API returns only billing-account, original paid-session, plan and setup-state selectors. Its existing-home read port must never invoke the purchase resolver: a buyer without a personal billing home gets an empty list. Current native home permission and the private ownership index are rechecked within the read transaction. Recovery opens the existing paid return; it does not create a new checkout. The first self-review found and corrected the host's potential provisioning side effect before consumer delivery.

Local evidence: all 972 application unit tests and 25 JavaScript checkout-flow tests pass; shared components/authentication production builds, full tests and lint pass; the complete host checkout integration package passes. Paymentus full backend tests pass the 90% gate. Deployed TEST catalog/CORS preflights pass without creating a payment. Paymentus `backend/v0.53.1` and Sneat libraries `0.27.31` are published, and the app installs the registry packages without local links. The full browser matrix passed 34 cases; its two delayed-recovery/optional-cancellation cases passed in Chromium and mobile WebKit after adapting the locator and asynchronous assertion to Ionic's checkbox. All 36 cases are covered locally; CI runs the complete matrix together.

Browser verification also caught a real title handoff race: Ionic can enter a new checkout view before the previous one leaves. A shared title owner now prevents an outgoing authentication view from overwriting the incoming purchase title. Tests cover same-title handoff, a destination's own title, exit and cached-view re-entry. The remaining shared email-input focus warning is a separate later authentication improvement; it does not prevent the verified journeys.

Dependency delivery: [shared component/auth fix #140](https://github.com/sneat-co/sneat-libs/pull/140), [published library release #141](https://github.com/sneat-co/sneat-libs/pull/141), [Paymentus recovery #111](https://github.com/sneat-co/paymentus/pull/111), [read-only home correction #112](https://github.com/sneat-co/paymentus/pull/112), and [native host binding #1252](https://github.com/sneat-co/sneat-go/pull/1252). The host merged at `4b579829bbbae8b8dedd5cdc2fb2d67dcd8e1030`; deployment and TEST revision verification are distinct from that merge receipt.

The unattended provider suite requires private dedicated TEST credentials and expected UID, or private storage state plus expected UID. It validates normal Firebase identity, destroys the temporary authentication continuation before admitting checkout requests, disables traces/video/screenshots and sanitizes sign-in failure logs. This environment has no configured dedicated TEST credentials; real-account authentication and provider payment acceptance remain unverified. The manual workflow mounts unpaid forms only and never enters card details or clicks Pay. Physical Mobile Safari and provider charge/decline/3DS acceptance are separate evidence, not inferred from simulated WebKit tests.

Provider checks are excluded from normal browser-test discovery and require explicit opt-in at both configuration and test declaration. Dedicated authentication refuses any configuration with traces, video or screenshots enabled before entering credentials or contacting checkout. Local discovery confirms the general suite excludes all four provider checks and the opt-in suite retains all four. A negative run verifies unsafe tracing is rejected before authentication; the positive unauthenticated TEST catalog/preflight check passes. The complete 36-case emulator checkout matrix also passed in GitHub CI.
