---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: Copy a demo DataTug project

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-project-copy?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-project-copy?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-project-copy?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/demo-project-copy?op=request-change) |
**Status:** Draft
**Source Ideas:** —

## Summary

Offer GitHub and local Git project copies after a browser SQLite demo is ready.

## Problem

A browser database explorer needs an optional path to owning its DataTug project without interrupting SQLite editing.

## Behavior

Journey: I open a DemoDB SQLite dataset. Once ready, I can keep browsing without taking any action, dismiss the offer, or reopen it. The offer gives exactly two project copy choices. GitHub resolves the source project revision, opens the existing New Project wizard, shows source and destination, preserves the draft through sign-in/OAuth, and creates a setup PR. After merging, the existing status check opens the project. Cancel returns to the demo. Local Git displays copyable clone and CLI commands. The OPFS database stays in the browser; neither choice silently exports it.

The source is datatug/datatug-demo-project/demo-project-1 at a verified immutable commit and folder tree. The wizard accepts generic GitHub source intent; this initial offer selects the public demo source. Destination Space and plan admission remain enforced by the existing backend flow.

## Acceptance Criteria

- Given SQLite is ready, when I do nothing, then tables remain usable and the nonblocking offer is available.
- Given the offer, when I dismiss it, then it stays compact for that dataset in the current tab session across table navigation, Back and reload; another dataset may show its own offer. If session storage is denied, dismissal survives component recreation in memory.
- Given the compact action, when I reopen it, then exactly GitHub and local Git choices appear.
- Given storage or database replacement warnings, then they appear before the optional project copy offer.
- Given a pending GitHub source lookup, when I dismiss, change datasets or navigate away, then its late success or error cannot redirect me or display stale feedback.
- Given the local choice, then verified git clone and datatug serve commands appear with the browser storage explanation.
- Given GitHub choice, then the source commit and folder tree are resolved before entering the wizard; errors stay visible and retryable.
- Given a copy draft, then refresh/sign-in/OAuth preserves its source and destination, and pending setup replay uses the same immutable source.
- Given a submitted setup, then pending/merged/closed/error behavior follows the existing project setup flow.
- Given copying, then the server separately authorizes source read and destination write; revoked source access or destination authority returns a visible denial with no unverified copy.
- Given a retry or pending setup replay, then the same immutable source commit and folder tree are reused. Destination conflicts remain visible; cancel leaves the source unchanged.
- Given unsafe paths, unsupported objects or oversized source content, then the backend rejects the copy before publishing destination content.
- A deployed GitHub journey receipt must cover real source read, destination PR creation and merge-to-open; mocked UI and backend tests are recorded separately from deployed acceptance.
- Focused component tests cover offer states and source request preservation; a browser journey checks dismissal, reopening, local instructions and continuing SQLite CRUD.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
