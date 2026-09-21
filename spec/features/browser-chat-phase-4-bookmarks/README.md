---
format: https://specscore.md/feature-specification
status: Approved
---

# Feature: Browser Chat Phase 4 Bookmarks

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-4-bookmarks?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-4-bookmarks?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-4-bookmarks?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/browser-chat-phase-4-bookmarks?op=request-change) |
**Status:** Approved
**Source Ideas:** —

## Summary

Project-scoped durable bookmarks for browser Chat RecordSets, Views and selections.

## Problem

Session results, views and selections disappear with their origin chat. Users need an explicit project-scoped retention action that keeps a bounded analytical snapshot reusable without exposing its row values to the AI provider.

## Behavior

Bookmarking a RecordSet, View or Selection copies its immutable result and effective row/column or exact cell-range mask into the existing DALgo IndexedDB database. Bookmark metadata owns a stable title and normalized, case-insensitive tags; session cleanup therefore cannot invalidate it. The Bookmarks workspace tab supports search, AND tag filtering, open, attach, dock, rename, tag edits and deletion. Attach/dock and agent workspace actions share the same domain service. Bookmark visibility is exact-scope and project-scoped, and model context contains only metadata and column names.

## Acceptance Criteria

### AC: durable-snapshot

A bookmarked RecordSet, View or Selection survives reload, clearing and deleting the origin session. A cell/range bookmark retains exactly its selected cells.

### AC: discovery-and-organization

Bookmarks support deterministic title changes, normalized tags, case-insensitive search, and AND filtering across supplied tags.

### AC: cross-session-context

Another session in the same scope can open, attach and dock a bookmark. A follow-up query binds local typed values only after attachment or docking; raw rows never enter provider context.

### AC: scope-isolation

Bookmarks cannot be listed or attached from another project or chat scope.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
