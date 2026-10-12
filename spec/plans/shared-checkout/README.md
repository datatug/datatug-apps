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
