---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: HTTP Query Editor

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-editor?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-editor?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-editor?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-editor?op=request-change) |
**Status:** Implementing
**Source Ideas:** —

## Summary

Postman-like create, edit, save and run of HTTP queries in the DataTug web app.

## Problem

HTTP was a selectable query type, but its editor was a hard-coded demo: the URL could not be edited, headers and parameters were not wired, there was no body, and a request could not be saved. Users need a Postman-like way to create, edit, save and run an HTTP request as a normal project query, without ever persisting credentials.

## Behavior

An HTTP query's type is chosen at creation and never changes. Its saved form is the Core `QueryDef`: `text` holds the URL and a new optional `http` block holds `method`, `headers` and `body`. A query saved before `http` existed (URL only) loads as a `GET`.

### Creating

#### REQ: create-http-query

The New query action sheet MUST offer **HTTP** in every project, shared (Firestore) projects included, and create a draft with an empty URL and method `GET`.

### Editing

#### REQ: request-line

The editor MUST show the method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), the URL and a Run button on one line, and every edit MUST update the query's request so the Save action enables.

#### REQ: params-synced-with-url

The Params section MUST list the URL's query-string pairs and editing, adding or removing a pair MUST rewrite the URL's query string; editing the URL MUST update the list.

#### REQ: headers-and-body

The Headers section MUST allow adding, editing and removing name/value rows. The Body section MUST be editable for methods that carry a body and disabled, with a hint, for GET and HEAD.

#### REQ: credential-headers-unsaved

A header whose name is a credential name (`isCredentialHttpHeader`, mirroring Core's `IsCredentialHTTPHeader`) MUST be marked with a lock and "not saved", MUST be usable for runs in the current session, and MUST NOT be sent on save.

### Saving

#### REQ: save-http-query

Saving MUST write the URL as `text` and `{method, headers, body}` as `http`, with credential headers removed. Change detection MUST consider URL, method, savable headers and body. Credential headers MUST remain in the editor after a save.

### Running

#### REQ: run-via-browser

By default Run MUST send the request with the browser's `fetch` (method, headers including credential headers, body unless GET/HEAD) and show the response.

#### REQ: run-via-server

A "Run via" toggle MUST switch a run to the DataTug server (`POST /v0/datatug/http/run`, request and response per the HTTP query contract). Base64 bodies MUST be decoded for display when they are valid UTF-8.

#### REQ: cors-fallback

When the browser call fails before any response, the editor MUST explain that the API likely blocks browser calls (CORS) and offer a one-click "Run via DataTug server" retry.

#### REQ: response-panel

The response panel MUST show the status code and text, duration, size and a truncated flag, with Headers, Body (pretty-printed when JSON) and Structured views.

## Acceptance Criteria

### AC: create-in-shared-project (verifies REQ:create-http-query)

**Given** a shared (Firestore) project
**When** the user opens New query
**Then** HTTP is offered and choosing it opens an empty `GET` request.

### AC: edit-enables-save (verifies REQ:request-line, REQ:headers-and-body)

**Given** an open HTTP query with no unsaved changes
**When** the user changes the method, URL, a header or the body
**Then** the request changes accordingly and the query shows as unsaved.

### AC: params-roundtrip (verifies REQ:params-synced-with-url)

**Given** the URL `https://x.test/a?b=1`
**When** the user sets parameter `b` to `2`
**Then** the URL becomes `https://x.test/a?b=2`.

### AC: body-disabled-for-get (verifies REQ:headers-and-body)

**Given** a `GET` request
**When** the user opens the Body section
**Then** the body input is disabled and a hint says GET requests have no body.

### AC: save-strips-credentials (verifies REQ:credential-headers-unsaved, REQ:save-http-query)

**Given** a request with headers `Accept` and `Authorization`
**When** the user saves
**Then** the saved `http.headers` contains only `Accept`, `Authorization` is still present in the editor marked "not saved", and no saved field contains its value.

### AC: legacy-url-only-loads-as-get (verifies REQ:save-http-query)

**Given** a stored HTTP query with only `text`
**When** it is opened
**Then** it loads as a `GET` with that URL.

### AC: run-browser (verifies REQ:run-via-browser, REQ:response-panel)

**Given** a `GET https://api.github.com/repos/datatug/datatug` request and Run via Browser
**When** the user presses Run
**Then** the response shows `200 OK`, duration, size and the pretty-printed JSON body.

### AC: run-server (verifies REQ:run-via-server)

**Given** Run via DataTug server
**When** the user presses Run
**Then** the editor posts the request to `datatug/http/run` and renders the returned status, headers and decoded body, with the truncated flag when set.

### AC: cors-offers-server-retry (verifies REQ:cors-fallback)

**Given** Run via Browser and an API that blocks browser calls
**When** the run fails before any response
**Then** a message mentions CORS and a "Run via DataTug server" button re-runs the same request through the server.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
