# Subscription management and recovery verification — 2026-10-13

Alex approved four follow-ups: real-provider/device verification, clearer pending purchases, hiding empty recovery, and shared subscription settings. This record distinguishes implemented behavior from acceptance that still requires external evidence.

## User journey

`/my?checkout=test` → actionable unfinished purchases or Subscriptions → `/subscriptions?checkout=test` → `/subscriptions/:accountId?checkout=test` → explicit cancellation confirmation or `/subscriptions/:accountId/transfer?checkout=test&requestId=…` → refreshed details. LIVE uses the same routes without `checkout=test`. Authentication retains the exact settings destination. The existing shared checkout remains independent of project creation.

Recovery entries show checkout start date, original amount paid, intended-space reference when supplied and a stable purchase reference. Older responses without metadata retain the full reference. A successful empty recovery result removes the card; loading, errors, Retry and pagination remain available.

The shared Sneat settings component lists personal Pro and independent Business accounts, receiving spaces, regular/discounted base prices, paid-through dates and cancellation state. A buyer can manage several Business accounts. Pro and other Business subscriptions stay active when one renewal is explicitly cancelled. Usage and separate add-ons are identified separately from displayed base prices.

Transfer requires an existing eligible company space and an explicit confirmation. Back and Cancel return to the selected subscription with its rail intact. Repeated clicks are blocked; refresh/retry retains the request ID. The server checks the buyer, current source/target roles, fresh financial evidence, source binding revision and destination vacancy atomically. A committed transfer can be replayed safely without a second access mutation.

## Transfer boundaries

- Only the paid-access beneficiary changes. Projects and memberships stay in their original space.
- Provider subscription/customer, payment history, billing anchor, paid-through/renewal date, scheduled cancellation, discount eligibility and launch-place identity stay unchanged.
- First-month unlimited usage does not consume paid allowance. Transfer retains only the original first month's remaining days; it never grants another introductory month.
- Later consumed current-period allowance requires settlement/allocation before transfer. Prior payable usage with unresolved closure/collection or a conflicting target usage window also blocks it. A bounded history scan fails closed when proof is incomplete.
- Separate prepaid capacity and SSO configuration/add-ons stay in their original space. They are never implicitly transferred or reset. Complete metered settlement remains separate work.
- The paying user's billing authority is distinct from beneficiary membership. A verified payer can view/cancel their own subscription after losing beneficiary membership; transfer requires current administrator authority in both company spaces.
- Historical space-bound Business accounts require an explicit financial-ownership migration into the new buyer-home index. This change does not infer a payer or silently migrate those records.

## Verified locally

The complete 38-case emulator browser matrix passed in Chromium and iPhone-profile WebKit. It covers the five starting situations separately for Pro and Business, monthly/yearly switching, separate authentication URLs, Back/Forward, refresh, payment-loader failure, delayed reconciliation, expiry, mixed-rail returns, destination permissions, existing subscriptions, paid setup/recovery, explicit optional Pro cancellation and shared settings transfer. Payment HTTP is simulated; Firebase authentication uses local emulators. The settings test also proves original project fields are unchanged and no checkout session is created.

All 975 application unit tests passed. Shared Sneat component tests/build/lint and backend/native-host tests pass against published dependencies. Production build and final lint/spec evidence are retained in the task logs. The final settings capture additionally waits for Ionic's incoming page to become interactive and outgoing transfer UI to disappear; an earlier transition capture was rejected as visual evidence.

Local receipts outside Git: `/private/tmp/checkout-management-browser-full.log`, `/private/tmp/checkout-management-browser-settings-final.log`, `/private/tmp/checkout-management-app-unit-final.log`, `/private/tmp/checkout-management-adapter-final-tests.log`, `/private/tmp/checkout-management-app-build-final.log`, `/private/tmp/checkout-management-host-final-tests.log`, `/private/tmp/checkout-management-host-final-vet.log`.

## Published dependencies

Shared UI [PR #142](https://github.com/sneat-co/sneat-libs/pull/142) and release [PR #143](https://github.com/sneat-co/sneat-libs/pull/143) are merged. The app consumes registry package `@sneat/components@0.27.32`, without local links.

Paymentus management [PR #113](https://github.com/sneat-co/paymentus/pull/113) and introductory-period correction [PR #114](https://github.com/sneat-co/paymentus/pull/114) are merged. Published `backend/v0.54.1` resolves to `ccf540cb4fb0f102b0cbd40a7177e7c23641e170`; exact target checks passed. Native host [PR #1253](https://github.com/sneat-co/sneat-go/pull/1253) wires that published version and the strict isolated TEST route boundary. Host/app landing and deployed revision each require their own receipt; dependency publication alone does not prove deployment.

## Unverified acceptance

At the original implementation snapshot, dedicated real TEST-buyer credentials/storage state were unavailable. The later provider verification below supersedes that limitation for normal authentication, Pro payment and paid return. Business payment, decline/additional authentication and physical-device acceptance remain incomplete.

Physical iPhone Safari is not available here. iPhone-profile WebKit is automated browser evidence only. No live payment, deployed customer subscription mutation or access-permission change was submitted. No IAM, origin allowlist or deployment configuration changes are part of this implementation.


Settled simulated destination captures: [desktop](subscription-settings-chromium.png), [mobile WebKit](subscription-settings-mobile-webkit.png). These show the transferred beneficiary and unchanged scheduled cancellation, without a provider payment.


### Broader library CI regression

Initial app PR CI failed `datatug-main:test`. Reproduction with the full local library suite identified the existing My DataTug creation fixture missing the newly required `ActivatedRoute` provider. The fixture now uses the real Angular router, and a regression checks that the Subscriptions link follows TEST/live query changes. The full library suite passes: 3,159 tests, with three pre-existing skips (208 passing files, one skipped file). No runtime behavior or test gate was weakened. Logs: `/private/tmp/checkout-management-main-coverage-final.log` and `/private/tmp/checkout-management-account-link-tests.log`.

Native host PR #1253 merged at `848775e1b63710a26ba18b4f9b4911b6fc47a6c9`; WB synchronized its clean canonical checkout and retired the source branch/worktree. Exact-source deployment run `38367428873` succeeded. The isolated TEST service subsequently adopted the same immutable image at revision `datatug-checkout-test-manage848775e1`; configuration and IAM fingerprints remained unchanged. Read-only boundary checks confirmed TEST catalog availability, authentication on protected management endpoints, and rejection of the LIVE selector. These checks do not prove an authenticated provider purchase or paid return.


### Post-merge main CI findings — unresolved delivery gate

Main CI [run 38375475833](https://github.com/datatug/datatug-apps/actions/runs/38375475833) failed after app merge `10d5bc181a6a71d266dabc32993846dbafac18d4`, although the PR checks passed and the normal frontend deployment succeeded. The checkout browser step passed. The app unit job hit Vitest's five-second deadline while cold-loading the complete lazy Angular feature graph in the route/WASM-pin integration assertion. General browser E2E failed the chat bookmark reload assertion: the dialog click completed before the tagged bookmark was confirmed durable. Neither failure is treated as a green main receipt.

Two narrow test-only repairs are prepared locally: give only the full lazy-feature integration assertion a twenty-second cold-load deadline, and wait for the joined tag in IndexedDB before the existing reload/persistence assertion. All original behavioral assertions remain. Focused routing tests pass; the full chat FK-join/persist journey passes three Chromium repeats. Logs: `/private/tmp/checkout-management-ci-route-repair.log`, `/private/tmp/checkout-management-ci-bookmark-repair.log`, `/private/tmp/checkout-management-ci-repair-lint.log`.

The repairs were initially held unpublished because six unrelated canonical edits blocked WB synchronization. Alex subsequently authorized reviewing, committing and merging those edits. Main CI remains a delivery gate until the repaired source lands and passes its exact-main checks; real-provider/device acceptance remains outstanding.


### Canonical review authorized by Alex

WB rescued all six original canonical edits into commit `edf4b3fcbd29dfca4d77be32ba91d18f112a4ea5`, verified the remote rescue ref, and restored exactly the captured state. WB then synchronized canonical main for PR #287 while retaining this worktree's unfinished CI repairs. The feature branch fast-forwarded to the subsequently updated origin/main before incorporating the rescue commit, so the original work remains recoverable in Git history.

Review retained the dedicated DataTug GA ID in all opt-out guards, including authentication and subscription settings. It declined the raw patch's new shared production analytics configuration/loader destination because that would also send Incidentius app events to DataTug's GA property. It also declined automatic GA/PostHog enablement: the existing handover records optional DataTug analytics as disabled pending a reviewed consent decision. DataTug remains default-off. Incidentius's original banner loaded the SDK before acceptance and advertised that analytics was off; the reconciled banner loads the dedicated property only after explicit acceptance, remembers declines, remains off on blocked storage, and strips query/hash from its configured page URL. The dynamic banner uses global styles and was visually inspected in the local built site. No property provisioning, IAM or deployment-setting change was made.

Verification of the reconciled source: 980 app unit tests pass; all eight built Incidentius landing tests pass, covering explicit acceptance, repeated acceptance, reload after decline, saved acceptance, unavailable storage and existing site contracts. App and landing lint pass after correcting the new consent fixture's empty method. The fixture correction is a separate test commit. Production and exact-head CI retain their own final gates; these local checks do not claim real provider or physical-device acceptance.

## Real TEST-provider verification — later 2026-10-13

This is partial acceptance, not a completed Business purchase receipt. Alex authorized dedicated TEST purchases/account creation and the existing clearly labelled TEST alerts. No LIVE payment was submitted. A new nonanonymous buyer was created through normal Firebase email/password signup, without administrator impersonation, custom tokens, IAM changes or another customer's credentials. Its credentials and browser state remain outside Git in a private directory, with credential/state files restricted to the owner. No manually created project or business space was required for the Pro purchase; normal Sneat authentication established its personal space.

Application source: deployed [PR #289](https://github.com/datatug/datatug-apps/pull/289), merge `52c6e94e05813c4bb0d33c676c838197fe3ca124`. Exact-main [CI 38401494227](https://github.com/datatug/datatug-apps/actions/runs/38401494227) and [deployment 38401494712](https://github.com/datatug/datatug-apps/actions/runs/38401494712) passed. The same production build was served to isolated local Playwright contexts without replacing any existing preview listener. The TEST backend used the immutable image from host `848775e1b63710a26ba18b4f9b4911b6fc47a6c9` / Paymentus `backend/v0.54.1`.

| Check | Actual result |
| --- | --- |
| Normal dedicated-buyer sign-in | Passed. Firebase UID, project, JWT subject/audience/issuer and nonanonymous status were checked before admitting checkout traffic. Current Playwright encodes IndexedDB exports as `valueEncoded`; the fixture now reads the real Firebase database record instead of assuming a plain exported `value`. |
| Real unpaid embedded form | Passed for Pro before its payment, and Business monthly. The strengthened repository smoke checks visible Stripe TEST mode, the selected product heading and the provider Pay button, beyond the existence of an iframe. |
| Pro monthly payment | Passed with Stripe's `4242` TEST card: regular €19, launch reduction €5.70, paid €13.30. Provider account, `livemode=false`, buyer/account/plan metadata, session and amount were independently checked through Stripe's TEST API. |
| Pro return and reconciliation | Actual return reached `https://datatug.app/pricing/return` with the same session and `mode=test`. Normal password authentication returned to the purchase with no app side panel. The first complete provider response had `ready=false`; a later fresh status read became ready. The public TEST success screen appeared, and three browser refreshes preserved rail/session with zero checkout writes. The test now exercises Check again rather than repeatedly asserting a cached initial response. |
| Business yearly payment | **Acceptance blocker:** the €990 regular / €297 launch reduction / €693 final quote and TEST card form loaded, but normal Pay submission left the session open/unpaid. The same session was retried locally, in ordinary headed Chromium and on deployed HTTPS. There was no visible validation error, no observed visible CAPTCHA challenge and no successful payment. Fields reported valid and no Stripe confirmation request was observed. Cause remains unresolved; these observations do not prove an application or provider root cause. No challenge was solved or bypassed. |
| Business monthly payment | The €99 regular / €29.70 launch reduction / €69.30 final quote loaded. Submission likewise remained unpaid. No Business activation, post-payment space provisioning, optional Pro choice, alert delivery or two-Business coexistence is claimed. |
| Duplicate charges | Before cleanup, the dedicated payer's complete provider inventory contained one customer, one active Pro subscription and exactly one successful charge (€13.30). Four Business sessions remained open/unpaid, including two separate smoke fixtures. Retries of each paid-attempt Business purchase reused its original session; no Business charge or subscription was created. |
| Shared subscription settings | **Important follow-up:** the provider still showed active Pro, and its paid return was ready, but settings returned `check_status` and did not offer cancellation after reconciliation evidence aged. The explicit cancellation test stopped before submitting a mutation. Source inspection confirms `CanCancel` requires fresh evidence and ordinary management reads do not refresh it. A safe refresh/reconciliation path needs verification before claiming real-provider cancellation or transfer acceptance. |

The final strengthened repository provider smoke passed three cases: catalog/preflights, Business unpaid form and the existing Pro paid return. A separate fixture check accepted actual encoded Firebase storage state; a deliberately mismatched expected UID failed authentication before checkout admission. App lint and SpecScore lint passed. Provider traces, video and automatic screenshots were disabled; limited manual payment diagnostics stayed private. Private local evidence is under `/private/tmp/datatug-provider-verification-20261013/` (redacted smoke logs and aggregate receipts; raw credentials/provider state must never be published).

Self-review round 1 (no additional agents, as requested) found that Playwright can retain authentication form values in automatic error-context files despite disabled screenshots. The fixture now navigates to a blank page, or closes it if navigation fails, before raising its sanitized error. Its unpaid-suite guard also blocks the current embedded Checkout `payment_pages/.../confirm` route as well as PaymentIntent/SetupIntent confirmation. These changes do not admit payment in ordinary CI.

### Runtime restoration and fixture cleanup

Only the dedicated TEST service's buyer binding was temporarily replaced to admit the new buyer; its image and original notification bindings were retained during purchases. The original `datatug-checkout-test-manage848775e1` template, secret references, annotations and 100% traffic were restored and compared with the pre-test snapshot. IAM bindings were unchanged, the temporary tag was removed, and both task-owned temporary revisions were deleted. No LIVE service was changed. An initial zero-traffic test configuration that omitted required Money bindings failed startup and was discarded; it is not evidence of a failure in the original deployed configuration.

Alex explicitly approved dedicated TEST fixture cleanup after automatic approval review initially rejected those irreversible mutations as outside the earlier purchase authorization. The exact saved fixture IDs, buyer/customer metadata and `livemode=false` were rechecked before each action. All four unpaid sessions were expired, the sole €13.30 TEST charge was fully refunded, and the Pro TEST subscription was cancelled without invoicing or proration. Independent provider rereads confirm zero open sessions, a cancelled subscription and €13.30 refunded out of €13.30 historically paid. No LIVE payment or other buyer was affected.

Read-only checks of this buyer's exact backend records confirmed the Pro terminal-full-refund latch, paid service off, no pending plan/offer application, reconciled money epochs, and zero paid subscriptions or reservation on its discount place. This proves the final state after refund plus cancellation, not the latency of a refund performed independently of cancellation. Business expiry was asynchronous: the first backend read still retained reservations; a later read confirmed all four quotes terminal-unpaid and all four reservations released. Provider expiry alone was not used as proof of ledger retirement. No financial record was manually edited.

Still unverified: Business paid return/setup, multiple paid Business spaces, real decline/3DS, Business refund behavior, independent full-refund access-expiry timing, cancellation through shared settings, transfer, OAuth/email-link/SSO return and physical iPhone Safari. Automated mobile WebKit remains separate evidence. Keep Business payment acceptance open; do not promote this partial record into launch approval.
