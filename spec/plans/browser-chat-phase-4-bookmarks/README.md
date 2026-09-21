---
format: https://specscore.md/plan-specification
status: Implemented
---

# Plan: Browser Chat Phase 4 bookmarks

**Status:** Implemented
**Source Feature:** browser-chat-phase-4-bookmarks
**Date:** 2026-09-21
**Owner:** alex
**Supersedes:** —

## Summary

Extend browser Chat’s existing DALgo session store with self-contained project bookmarks and surface the actions through the shared workspace service and Bookmarks tab. This remains the Phase 4 prerequisite: collections and provider-side row transfer are deferred.

## Approach

The store owns snapshot copying and metadata lifecycle so UI and agent actions cannot diverge. Workspace references name bookmarks and resolve their local snapshot for attachment/docking and follow-up binding. The page renders project-visible bookmarks and delegates every mutation to that service.

## Tasks

### Task 1: Durable bookmark store

**Status:** complete
**Verifies:** browser-chat-phase-4-bookmarks#ac:durable-snapshot, browser-chat-phase-4-bookmarks#ac:scope-isolation

Copy a bounded snapshot into the existing DALgo IndexedDB database and apply title/tag/delete operations there.

### Task 2: Shared workspace actions and browser tab

**Status:** complete
**Verifies:** browser-chat-phase-4-bookmarks#ac:discovery-and-organization, browser-chat-phase-4-bookmarks#ac:cross-session-context

Expose Bookmark references through the shared workspace action boundary and add browse, open, attach, dock, rename, tag and delete controls.

### Task 3: Focused verification

**Status:** complete
**Verifies:** browser-chat-phase-4-bookmarks#ac:durable-snapshot, browser-chat-phase-4-bookmarks#ac:cross-session-context

Add deterministic domain coverage and run the focused browser journey with its fake provider.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
