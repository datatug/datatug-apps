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

Journey: pricing/deep link → common summary and inline Sneat authentication → authoritative quote/payment → durable confirmation → personal completion or post-payment Business attachment → existing project/space home or optional project setup. Reuse the current Stripe adapter, auth panel, native idempotent Spaceus provisioning and Paymentus ownership/reconciliation; domain logic belongs in the owning extension, with host wiring only. Buyer identity is separate from the base-service destination fence. Preserve stable subscription/discount lineage through attachment and future transfer. No live payments or deployment-setting changes. The existing launch task owns shared management/transfer follow-up; this task supplies the checkout contract and reusable foundations.

## Tasks

### Task 1: Shared shell, summary and authentication context

**Status:** complete
**Verifies:** checkout-journey#ac:checkout-shell, checkout-journey#ac:price-summary, checkout-journey#ac:auth-return

Suppress the application panel across checkout and auth continuations without remounting the payment outlet. Share regular/discount/final summary, period vocabulary and annual promotion. Preserve period/test context on pricing Back and use existing Sneat authentication directly. Implemented locally with rendered shell, price and asynchronous route tests; see feature implementation evidence. Complete for this bounded task, not whole checkout acceptance or real authentication-return proof.

### Task 2: Durable Business purchase before space attachment

**Status:** planning
**Verifies:** checkout-journey#ac:business-after-payment, checkout-journey#ac:durable-attachment

Add an owned Paymentus pending billing-account purchase contract with buyer authorization, server-mode isolation and stable idempotency. Keep optional space reference separate from billing ownership. Do not weaken existing space-service authorization or invent a dummy usable space. Persist confirmed paid-unlinked purchases independently of browser return. Reuse native request-ID-based provisioning after payment; atomically fence target base ownership and replay attachment safely.

### Task 3: Independent subscriptions and launch places

**Status:** in_progress
**Verifies:** checkout-journey#ac:multiple-space-ownership, checkout-journey#ac:independent-subscriptions, checkout-journey#ac:optional-pro-cancellation, checkout-journey#ac:introductory-usage

Verify existing per-space purchase and per-subscription discount fences for one buyer with Pro and multiple Business spaces. Preserve the paying identity and space recipient separately. Check same-space duplicate/retry, effective end, full refund and live/test isolation. Retain Pro unless the customer explicitly schedules end-of-term cancellation through a supported owned operation.

### Task 4: Local scenarios, recovery and publication

**Status:** in_progress
**Verifies:** checkout-journey#ac:scenario-coverage, checkout-journey#ac:recovery, checkout-journey#ac:rail-isolation, checkout-journey#ac:safari-proof

Exercise all ten starting situations using local fixtures and isolated provider test rails where configured; record what is fixture-only, browser-observed or unverified. Test auth return, delays, retries, refresh, browser Back and mobile layout. Run repository checks, self-review (Alex requested no additional agents), publish the resulting changes through WB, and record exact-head verification. Physical Safari and real test-provider evidence must not be inferred from fixtures.

### Task 5: Coordinate management/transfer follow-up

**Status:** complete
**Verifies:** checkout-journey#ac:multiple-space-ownership

Coordinate with the DataTug Launch Epic’s `space-subscription-management` specification. Record paid-access-only transfer, unchanged projects, retained dates/discount/introductory history/usage and separate add-ons. Do not implement transfer settings or expand metered billing in the launch checkout task.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
