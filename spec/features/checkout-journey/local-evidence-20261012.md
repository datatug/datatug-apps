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
