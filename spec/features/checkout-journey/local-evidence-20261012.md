# Local checkout matrix screenshots

2026-10-12, separate authentication-page revision. All 22 local cases passed. The unsigned page has a type-specific title and one Sneat.co prompt above the existing form, with no subscription details. The signed-in page has a standard white Ionic card, in-card billing tabs and a 30-day base-payment guarantee. Both browser tab titles include the subscription type. Firebase emulators; checkout HTTP is simulated. Pro images show the annual quote after authentication, period switch, browser Back/Forward and refresh. Business images show linked confirmation after simulated payment and attachment. These are not real provider or physical Safari receipts.

- [checkout-journey-business-business-space-without-project-chromium](checkout-journey-business-business-space-without-project-chromium.png)
- [checkout-journey-business-business-space-without-project-mobile-webkit](checkout-journey-business-business-space-without-project-mobile-webkit.png)
- [checkout-journey-business-neither-project-nor-business-space-chromium](checkout-journey-business-neither-project-nor-business-space-chromium.png)
- [checkout-journey-business-neither-project-nor-business-space-mobile-webkit](checkout-journey-business-neither-project-nor-business-space-mobile-webkit.png)
- [checkout-journey-business-new-unsigned-user-chromium](checkout-journey-business-new-unsigned-user-chromium.png)
- [checkout-journey-business-new-unsigned-user-mobile-webkit](checkout-journey-business-new-unsigned-user-mobile-webkit.png)
- [checkout-journey-business-project-and-business-space-chromium](checkout-journey-business-project-and-business-space-chromium.png)
- [checkout-journey-business-project-and-business-space-mobile-webkit](checkout-journey-business-project-and-business-space-mobile-webkit.png)
- [checkout-journey-business-project-without-business-space-chromium](checkout-journey-business-project-without-business-space-chromium.png)
- [checkout-journey-business-project-without-business-space-mobile-webkit](checkout-journey-business-project-without-business-space-mobile-webkit.png)
- [checkout-journey-pro-business-space-without-project-chromium](checkout-journey-pro-business-space-without-project-chromium.png)
- [checkout-journey-pro-business-space-without-project-mobile-webkit](checkout-journey-pro-business-space-without-project-mobile-webkit.png)
- [checkout-journey-pro-neither-project-nor-business-space-chromium](checkout-journey-pro-neither-project-nor-business-space-chromium.png)
- [checkout-journey-pro-neither-project-nor-business-space-mobile-webkit](checkout-journey-pro-neither-project-nor-business-space-mobile-webkit.png)
- [checkout-journey-pro-new-unsigned-user-chromium](checkout-journey-pro-new-unsigned-user-chromium.png)
- [checkout-journey-pro-new-unsigned-user-mobile-webkit](checkout-journey-pro-new-unsigned-user-mobile-webkit.png)
- [checkout-journey-pro-project-and-business-space-chromium](checkout-journey-pro-project-and-business-space-chromium.png)
- [checkout-journey-pro-project-and-business-space-mobile-webkit](checkout-journey-pro-project-and-business-space-mobile-webkit.png)
- [checkout-journey-pro-project-without-business-space-chromium](checkout-journey-pro-project-without-business-space-chromium.png)
- [checkout-journey-pro-project-without-business-space-mobile-webkit](checkout-journey-pro-project-without-business-space-mobile-webkit.png)

Separate unsigned-page captures:

The later Playwright revision passes all 30 local cases and extends Pro through
TEST confirmation, with payment-loader retry, expired-return and mixed-rail
checks. The images above remain the earlier quote/confirmation evidence rather
than being silently relabeled as new provider receipts. The separate deployed
TEST preflight is currently red; see the feature's TEST boundary correction and
the [e2e guide](../../../apps/datatug-app/e2e/README.md#subscription-checkout).

- [checkout-journey-business-new-unsigned-user-chromium-sign-in](checkout-journey-business-new-unsigned-user-chromium-sign-in.png)
- [checkout-journey-business-new-unsigned-user-mobile-webkit-sign-in](checkout-journey-business-new-unsigned-user-mobile-webkit-sign-in.png)
- [checkout-journey-pro-new-unsigned-user-chromium-sign-in](checkout-journey-pro-new-unsigned-user-chromium-sign-in.png)
- [checkout-journey-pro-new-unsigned-user-mobile-webkit-sign-in](checkout-journey-pro-new-unsigned-user-mobile-webkit-sign-in.png)


## Final integration and mobile CI repair

WB synchronized the checkout branch with target `1a97b3d883a596919604ddb0069c48c34969ec45`, producing integration head `0c5af37fd10b04545bc8a31aa0f118c0cd78c03a`. The complete 34-case checkout suite passed locally on that head. Linux CI run `38285980296` then passed 33 cases and failed the mobile Business scenario without a project or business space: its trace shows Firebase's fixed emulator warning intercepting the activation tap during focus/scroll layout changes, with no purchase-setup request issued. This CI result was not waived or reported as a pass.

The test now finishes input focus and centers the activation control before its ordinary Playwright click. It does not force clicks, retry activation, change production UI, or relax successful setup/refresh/one-request assertions. The affected mobile case passed five consecutive repeats; the complete 34-case Chromium/mobile WebKit suite then passed together in 2m51s. Focused ESLint and diff whitespace checks passed. Logs: `/private/tmp/business-checkout-mobile-focus-repeat.log`, `/private/tmp/business-checkout-mobile-focus-full.log`, and `/private/tmp/business-checkout-mobile-focus-lint.log`.

Alex explicitly approved host-first delivery after the automatic approval review held that sequence. Host PR #1250 landed through WB at `5139a2b58f7ce1a884960584a261d496e68af571`, with canonical synchronization and host worktree/branch cleanup. Normal deployment run `38288580962` succeeded for that exact source; the read-only TEST image preflight passed. Runtime adoption and authenticated real-provider checks require their own receipts and are not implied by the emulated suite. No payment, customer subscription change or access-permission change was made during these tests.
