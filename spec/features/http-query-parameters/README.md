---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: HTTP Query Parameters

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-parameters?op=explore) | [Edit](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-parameters?op=edit) | [Ask question](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-parameters?op=ask) | [Request change](https://specscore.studio/app/github.com/datatug/datatug-apps/spec/features/http-query-parameters?op=request-change) |
**Status:** Draft

**Source Ideas:** —

## Summary

Declare parameters on a saved HTTP query, reference them as `{name}` placeholders in its URL, headers and body, bind their values from a selected result row, the session context bag or manual entry, and substitute them safely, with one placeholder contract shared with the DataTug CLI.

## Problem

HTTP queries are sent literally (see [HTTP Query Editor](../http-query-editor/README.md)): there is no parameter substitution, so a request such as a carrier's shipment lookup cannot take an order reference or a date from the data the user is looking at. SQL queries already declare `QueryDef.Parameters`, and the CLI already treats a saved HTTP query's URL as a `{name}` template through dalgo2http. The web app, the server run endpoint and the CLI therefore disagree about what a saved URL means, and substituting values into a request is a classic injection and SSRF surface that must be specified before it is built.

## Behavior

Worked example used throughout: `GET https://carrier.example/v1/shipments?order_ref={order_id}&as_of={as_of}`, where `order_id` and `as_of` come from a selected row of another query. The feature is generic and is not tied to any demo project.

The shared placeholder contract is the one the CLI already implements through dalgo2http. Evidence version is the CLI's pinned dalgo2http v0.2.1 (`datatug-cli/go.mod:30`): placeholder expression `descriptor.go:115`, rendering and escaping `request.go:35-70`, missing-value error `request.go:45`, config validation `config.go:159-190`; on the CLI side `pkg/httpsource/params.go:11` and `:41-59`. dalgo2http v0.4.0 (the latest) differs only in line numbers (`descriptor.go:120`, `request.go:29-86`). This feature extends the URL contract to headers and body and does not change what a URL template means: literal queries without placeholders keep working unchanged in both the CLI and the web app.

Saved shape (existing, unchanged): `text` is the URL template, which the file store writes to the `<id>.query.http` sidecar; the `http` block (`method`, `headers`, `body`) and `parameters` are saved in `<id>.query.json`. The CLI reads only the sidecar URL (`datatug-cli/pkg/httpsource/load.go:97-105`) plus `parameters` from the JSON, and never sees `method`, `headers` or `body`.

The web rules below are NEW and stricter than the CLI's: no placeholders in host, userinfo or fragment, and `.`/`..` path values rejected. The CLI classifies a placeholder with `strings.Contains` on the text before the first `?` (`params.go:41`) and does not check these.

### Placeholder contract

#### REQ: placeholder-syntax

A placeholder is `{name}` where `name` matches `[a-zA-Z0-9_]+` (the dalgo2http and CLI expression `\{([a-zA-Z0-9_]+)\}`). `{{name}}`, `:name`, `$name` and `${name}` are NOT placeholders. There is no escape for a literal `{name}`; text that must contain braces uses JSON objects (`{"`), which never match. Placeholders are allowed only in: URL path segments, URL query-string values (including a value fragment such as `ref=ord-{id}`), header values and the body. They are NOT allowed in the scheme, userinfo, host or port, the fragment, a query-string name, a header name or the method, the value of the `Content-Type` header (it decides how the body is encoded), or the value of a routing or transport header the network layer controls (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `X-Forwarded-*`, `X-Original-URL`, `X-Rewrite-URL`, `X-Host` and the other entries of core `reservedHTTPHeaders`); such a template is invalid. A URL that contains a placeholder must also be an absolute `http` or `https` URL, with no spaces, control characters or backslashes. A URL without a placeholder is not subject to this check.

#### REQ: placeholder-semantics

Substitution is a single pass over the template: substituted text is never rescanned, so a value containing `{other}` is inserted literally. A placeholder with a value that cannot be resolved follows `declare-parameters` (`isRequired`); a missing required value fails the run naming the parameter (dalgo2http `ErrMissingParam`, `request.go:45`) and is never sent empty or as `{name}`. An empty string, like null, is a missing value: it falls through to the next source in `binding-sources`, then to the default, else the run fails, so a request such as `?q=` cannot be sent on purpose. Every placeholder appears in the declared parameters and every declared parameter appears as a placeholder in at least one position; the CLI already rejects both mismatches (`params.go:41-59`) and the web app MUST apply the same rule on save. Declared parameters absent from the template are NOT appended as extra query pairs (dalgo2http appends them, `request.go:61-69` in v0.2.1, `61-77` in v0.4.0, but that path is unreachable from the CLI because of the same rule, and is not adopted).

The web substituter preserves the author's query-pair order and the template's text outside placeholders, and only encodes substituted values. dalgo2http instead ends with `parsed.RawQuery = q.Encode()` (`request.go:70` in v0.2.1, `:78` in v0.4.0), which sorts keys and re-encodes the whole query; the CLI and web requests are therefore equivalent (same method, scheme, host, path and query parameters as a multiset), not byte-identical.

#### REQ: legacy-literal-braces

A saved HTTP query with no declared parameters keeps running literally as today. When such a query's template contains a `{name}` placeholder, the editor MUST warn, without blocking save or run, that it looks like a placeholder and offer to declare it. Once a query declares at least one parameter, the rules of `placeholder-semantics` are strict and blocking.

#### REQ: params-table-placeholders

The editor's Params table (`params-synced-with-url` in [HTTP Query Editor](../http-query-editor/README.md)) lists and edits the template's literal query-string pairs, and a value may be or contain a `{name}` placeholder. Reading the URL into rows and rewriting rows into the URL MUST preserve every `{name}` placeholder verbatim and MUST NOT percent-encode its braces or name, including after edits to other rows (today's `encodePart` in `http-url-params.ts` keeps `{`, `}` and `/`; the preserved form is `{name}` only and `{{name}}` is just literal text). The Params table is not the Parameters section: Params are URL query text that may reference placeholders, while Parameters (`declare-parameters`) hold declarations, defaults, meaning and run-time values. A placeholder typed in a Params row is added to the template and flagged until declared.

### Declaring parameters

#### REQ: declare-parameters

An HTTP query MAY declare `QueryDef.Parameters` using the existing `ParameterDef` shape (`id`, `type`, `title`, `defaultValue`, `isRequired`, `isCredential`, `meta`; `isCredential` marks a parameter used only in credential headers, see `credentials-run-time-only`) with these rules: `id` is the placeholder name and matches the placeholder syntax; ids are unique; `type` is one of `string`, `integer`, `number`, `boolean`, `bit`, `date`, `datetime`; `isMultiValue`, `lookup`, `minLength` and `maxLength` are rejected on HTTP queries in this version; `defaultValue` must match `type` per the existing `ParameterDef.Validate`.

`isRequired` means: required (true) means a missing value, after the precedence of `binding-sources` including the default, is a run error. Not required (false, the default) means an absent value substitutes `defaultValue`; a not-required parameter with no `defaultValue` is rejected on save in every position. Every placeholder therefore always receives a value or the run fails, matching the CLI, which fails with `ErrMissingParam` on any missing value (dalgo2http v0.2.1 request.go:45); a query pair is never silently dropped. The editor shows a Parameters section that lists every placeholder found in the template, adds the declaration with one action, and flags declared-but-unused parameters.

#### REQ: parameter-meta

A parameter MAY carry `meta: {entity, field}` (the existing `EntityFieldRef`), naming a meaning in the project's meaning graph such as `Order.id`. `meta` has no effect on substitution; it is the key used to bind values from a selected row or the context bag (`binding-sources`). The reserved type `bit` renders as `0`/`1`, `boolean` as `true`/`false`, `integer` in decimal, `number` in shortest decimal form without an exponent, `date` as `YYYY-MM-DD`, `datetime` as RFC 3339 UTC.

### Binding

#### REQ: binding-sources

A parameter value is resolved from the first source that supplies one, in this precedence: (1) a value typed in the run panel for this run; (2) the selected row(s) of the query result the run was launched from; (3) a board or card parameter binding (`WidgetParameterBinding`: constant `value` or `boardParameterId`), defined here but delivered by the later board feature (see Out of scope); (4) a session context bag entry whose subject matches the parameter's `meta`; (5) the declared `defaultValue`. A required parameter with no value blocks the run and shows an inline input for it; nothing is sent.

#### REQ: row-binding

From a query result grid, a "Run HTTP query" action for the selected row lists saved HTTP queries whose declared parameters can be bound from that row. A parameter binds to a column of the row when (in order): the column's meaning-graph mapping equals the parameter's `meta` (`entity.field`), reusing the ranking of [Project cards](../project-cards/README.md) `input-matching`; the column name equals the parameter id, case-insensitively; or the user picked the column in the run panel. A null column value is a missing value. For the worked example, a selected row with columns `OrderRef` (mapped to `Order.id`) and `ShippedOn` binds `order_id` and `as_of`.

#### REQ: multi-row-selection

A run binds from exactly one row: the single checked row when exactly one row is checked in the grid, otherwise the focused row. When several rows are checked the action is disabled with the reason "select one row", and no request is sent; the editor never runs once per row and never merges rows. Multi-value parameters and fan-out over rows are a later feature (see Open questions).

#### REQ: context-bag-binding

A context bag entry supplies a value only when its subject's concept and field equal the parameter's `meta` and its value is a scalar; a set-valued entry is ignored for HTTP queries. The run panel shows where each value came from (typed, row, bag, default) and lets the user override any value for this run only. Overrides are not saved to the query and not written to the bag.

#### REQ: type-coercion

A bound value is coerced to the parameter's `type` before substitution, and a value that cannot be coerced blocks the run with an error naming the parameter and the value's source, never a silent fallback. A `datetime` value bound to a `date` parameter is truncated to its UTC calendar date. Date and time values come only from a bound source or the business clock entry the project places in the context bag; the wall clock is never supplied implicitly, so the same bound inputs always produce the same request. In the worked example `as_of` is `date`; a row value `2026-03-04T23:30:00Z` becomes `2026-03-04`.

### Substitution and safety

#### REQ: encoding-per-position

Values are encoded for the position they land in: a URL path segment uses `url.PathEscape` semantics (so `/` becomes `%2F`) and a value of exactly `.` or `..` is rejected; a URL query value uses `url.QueryEscape` semantics (the CLI behavior, `request.go:57-60`); a header value is inserted as is after the line-break check below; a body is substituted per `body-substitution`. Position is decided by where the placeholder sits in the template, with the path/query split at the first `?` as in the CLI (`params.go:30-33`).

#### REQ: header-injection

After substitution, a header value containing any ASCII control character other than TAB (this includes CR, LF and NUL), or DEL, is a run error naming the header and the parameter. Characters are never stripped or escaped to make the value pass. Header names and the method cannot contain placeholders, so a value cannot add a header.

#### REQ: body-substitution

Body mode is decided by the request's `Content-Type` header: JSON when it is `application/json` or ends in `+json`; form when it is `application/x-www-form-urlencoded`; otherwise text. There is no sniffing of the body.

JSON mode. A scanner walks the template tracking whether it is inside a string literal, honoring backslash escapes (`\"` and `\\`), and finds every placeholder with its context. A placeholder inside a string literal receives the value JSON-string-escaped (`"`, `\`, control characters, without added quotes). A placeholder in a value position outside any string (for example `{"qty":{qty}}`) is allowed only for `integer`, `number`, `boolean` and `bit` parameters and is substituted as a JSON literal (`NaN` and infinities are rejected, `bit` becomes `0` or `1`); a `string`, `date` or `datetime` parameter there is rejected. A placeholder inside an object key, or anywhere that is not a value position, is rejected. A value can therefore never add, close or reorder JSON structure. Invalid JSON surrounding the placeholders is rejected on save in JSON mode.

Form mode: each value uses query-value escaping. Text mode: the value is inserted verbatim, and CR and LF are allowed in the body only (never in headers). A body placeholder on a method that carries no body (GET, HEAD, OPTIONS) is rejected on save.

#### REQ: credentials-run-time-only

Saved templates and `defaultValue` fields pass the existing embedded-secret screen (`embeddedCredentialReasonWithoutDSN`), and credential headers are still never saved (`credential-headers-unsaved`). A placeholder in the URL userinfo is rejected. A credential header (per `isCredentialHTTPHeader`) may use a placeholder only in the session-only editor value. A parameter used in a credential header MUST be declared `isCredential: true`, and a parameter declared `isCredential` MUST NOT be used in any other position (URL, other header, body), so a credential value cannot leak elsewhere. It takes typed run-time values only: it MUST be declared `isRequired: true` with no `defaultValue` and no `meta` (a not-required credential parameter is rejected on save), and values from a row, a board binding or the context bag are refused. The record of a run never contains a credential parameter's value; it keeps parameter ids and sources, and values only for non-credential parameters. Today that record is the parameter line shown with the result of the run; the spec places no value of a credential in any other store, and when a run history is added it MUST follow the same rule. The credential field in the editor MUST ask the browser not to save the value (`autocomplete="new-password"`).

#### REQ: substitution-location

Substitution is performed by one shared implementation with the same results in both places: in the browser for "Run via Browser" and on the server for "Run via DataTug server". The server never trusts a client-substituted URL as template output: in template mode it substitutes itself, so the SSRF guard (public http(s) only, redirects re-checked, credential headers stripped cross-host) always evaluates the FINAL URL, and the guard result for a template run equals the result for the same literal URL.

#### REQ: server-template-endpoint

`POST /v0/datatug/http/run` keeps accepting a literal request unchanged. A request that carries a `parameters` field, even an empty array, is in template mode: `url`, `headers` and `body` are templates, `parameters` is a list of `{id, type, value}` (the existing `datatug.Parameter` shape) with scalar values, and the server applies `placeholder-syntax` through `body-substitution`. In template mode a placeholder without a supplied value, a supplied id with no placeholder, an invalid type or value, or a rejected position returns a 400 with a structured body, and no outbound request is made. The body is `{"error": {"code": "http_template", "message": <fixed text>, "templateCode": <core error code>, "parameter": <id>, "position": <position>, "header": <name>}}`. `parameter`, `position` and `header` are present only when they apply, and the server drops a parameter id or header name that is not plain (`[a-zA-Z0-9_]+` for an id, an HTTP token for a header), never echoing a caller-chosen string. The body never holds a parameter value or free-text detail, so the web app writes its own plain sentence for each `templateCode` (see `error-copy`). Existing limits (256 KiB request body, 50 headers) apply to the substituted request.

#### REQ: cli-parity

Today the CLI runs only the URL template as a GET, with `parameters` from the query JSON; it never reads `method`, `headers` or `body`. A query whose placeholders sit only in URL path or query values and whose method is GET therefore produces an equivalent request (same method, scheme, host, path and query parameters as a multiset) in the CLI and the web app for the same values. The CLI rejecting queries that use header or body placeholders or a method other than GET is a REQUIRED NEW CLI CHANGE, tracked as a separate datatug-cli task and not part of this spec's web delivery; the CLI's current behavior is unchanged until it ships. Until then the web editor MUST warn, non-blocking, when a query uses features the CLI cannot run (non-GET method, headers, body, or placeholders outside the URL), saying the CLI would run only the URL as GET.

#### REQ: preview

The editor shows the resolved request (final URL, header values with credential values masked, body) for the current values before and after a run, marks each substituted segment with its source (a segment shows its source on hover and by underline style, not by colour alone), and keeps the template as the only saved form.

#### REQ: error-copy

Every problem the editor reports about a template, a value or a server template error is one plain sentence naming the placeholder as `{name}` and, where it helps, the part of the request, followed by one piece of advice. It is built from the structured fields (`templateCode`, `parameter`, `position`, `header`) and never from server text or a value. It does not chain clauses with colons and does not mention a value source the user cannot use yet, so the hint on the Parameters section lists only the sources that are live. A placeholder in the host is reported as "can't be in the web address's host", with the advice to use a separate query for each host, also for a query with no declared parameters, where it is shown instead of the legacy-brace note because it can never work.



### Out of scope / later

#### REQ: board-widget-deferred

This feature does not add a board HTTP editor or make the new-card-dialog "HTTP request" card type reachable, and does not change `HTTPRequest` in `widget-http.ts`. Reason: that widget carries its own inline `url`, `headers` and `parameters` and is a different model from a saved HTTP query; reaching it requires choosing between binding a saved HTTP query (as `SQLWidgetSettings` does) and keeping an inline request, which is a separate decision with its own card and dashboard acceptance criteria. The board binding of `binding-sources` item 3 is specified as a contract only and becomes testable when that feature ships. Until then the card type stays unlisted or marked unavailable and is not extended.

## Dependencies

- http-query-editor

## Acceptance Criteria

### AC: url-template-shared-with-cli (verifies REQ:placeholder-syntax, REQ:placeholder-semantics, REQ:cli-parity)

**Given** a GET query `https://carrier.example/v1/shipments?order_ref={order_id}&as_of={as_of}` with parameters `order_id` and `as_of`
**When** it runs from the web app and from the CLI with `order_id=A/1 2` and `as_of=2026-03-04`
**Then** both send equivalent requests: same method, scheme, host and path, and the query parameters `order_ref=A/1 2` and `as_of=2026-03-04` as a multiset (comparison parses the query, so pair order and the encoding of `/` do not matter); the web request keeps the template's pair order.

### AC: mismatch-blocks-save (verifies REQ:placeholder-semantics, REQ:declare-parameters)

**Given** a template with `{order_id}` and parameters `order_id` and `region`
**When** the user saves
**Then** save is refused naming `region` as unused; and given `{order_id}` with no declaration of it, save is refused naming `order_id` as undeclared.

### AC: legacy-query-unchanged (verifies REQ:legacy-literal-braces)

**Given** a saved HTTP query with no parameters whose URL contains `{x}`
**When** it is opened and run
**Then** a non-blocking warning offers to declare `x`, and the request is sent exactly as stored.

### AC: forbidden-positions (verifies REQ:placeholder-syntax)

**Given** a template with a placeholder in the host, in a query-string name, or in a header name
**When** the user saves
**Then** save is refused naming the position, and `{{name}}` is treated as literal text.

### AC: row-binds-parameters (verifies REQ:binding-sources, REQ:row-binding, REQ:type-coercion)

**Given** a result grid whose selected row has `OrderRef` mapped to `Order.id` and `ShippedOn = 2026-03-04T23:30:00Z`, and the worked-example query with `order_id` (`meta: Order.id`) and `as_of` (`date`)
**When** the user runs the query from that row
**Then** the request carries the row's order reference and `as_of=2026-03-04`, and the run panel shows both values with source "row".

### AC: precedence-and-required (verifies REQ:binding-sources, REQ:context-bag-binding)

**Given** `order_id` is required, has no default, and the bag holds a matching scalar entry and the row holds another value
**When** the user runs from the row
**Then** the row value is used; and when neither exists, the run is blocked with an inline input for `order_id` and nothing is sent.

### AC: multi-row-rejected (verifies REQ:multi-row-selection)

**Given** two rows selected in the result grid
**When** the user opens the Run HTTP query action
**Then** it is disabled with "select one row" and no request is sent.

### AC: bad-coercion-blocks (verifies REQ:type-coercion)

**Given** `as_of` is `date` and the bound value is `not-a-date`
**When** the user runs
**Then** the run is blocked with an error naming `as_of` and its source, and nothing is sent.

### AC: path-encoding-and-dot-segments (verifies REQ:encoding-per-position)

**Given** `https://x.test/orders/{id}/items`
**When** `id` is `a/b` the URL becomes `https://x.test/orders/a%2Fb/items`; and when `id` is `..`
**Then** the run is rejected and nothing is sent.

### AC: header-crlf-rejected (verifies REQ:header-injection)

**Given** a header `X-Ref: {order_id}` and a bound value `A\r\nX-Evil: 1`
**When** the user runs
**Then** the run fails naming `X-Ref` and `order_id`, and no request is sent.

### AC: json-body-cannot-change-structure (verifies REQ:body-substitution)

**Given** body `{"ref":"{order_id}","qty":{qty}}` with `qty` of type `integer`
**When** `order_id` is `a","admin":true,"x":"` and `qty` is `3`
**Then** the body is `{"ref":"a\",\"admin\":true,\"x\":\"","qty":3}`; and a `string` parameter placed unquoted is refused on save.

### AC: credentials-never-saved-or-bound (verifies REQ:credentials-run-time-only)

**Given** a header `Authorization: Bearer {token}` and a row column named `token`
**When** the user saves and then runs from that row
**Then** the saved query contains no `Authorization` header, the row value is refused for this header, and a typed run-time value is accepted.

### AC: server-guard-on-final-url (verifies REQ:substitution-location, REQ:server-template-endpoint)

**Given** a template-mode request `https://x.test/r?u={u}` whose resolved URL redirects to a private address, and a template-mode request `http://{host}/`
**When** the server runs each
**Then** the first is stopped by the SSRF guard exactly as the same literal URL would be, with no request to the private address, and the second returns the structured 400 with `templateCode` `forbidden-position`, `parameter` `host` and `position` `host`.

### AC: literal-request-unchanged (verifies REQ:server-template-endpoint)

**Given** a request to `/v0/datatug/http/run` with no `parameters` field and a URL containing `{x}`
**When** the server runs it
**Then** the URL is sent literally as today.

### AC: cli-rejects-non-url-placeholders (verifies REQ:cli-parity)

**Given** the future datatug-cli change tracked by `cli-parity` has shipped (this AC cannot pass before it) and a saved POST query with a body placeholder
**When** the CLI loads it
**Then** it reports the query unsupported and sends nothing with an unsubstituted placeholder.

### AC: preview-masks-credentials (verifies REQ:preview)

**Given** a query with a session-only `Authorization` header and bound parameters
**When** the user views the resolved request
**Then** the final URL and body show values with their sources, and the credential header value is masked.

### AC: board-card-stays-unavailable (verifies REQ:board-widget-deferred)

**Given** this feature is shipped
**When** the user opens New card
**Then** the "HTTP request" card type is still not offered as a working type and `HTTPRequest` is unchanged.

### AC: cli-warning-in-editor (verifies REQ:cli-parity)

**Given** a query with method POST, or a header or body placeholder
**When** the user opens it
**Then** a non-blocking note says the CLI would run only the URL as GET.

### AC: params-table-keeps-placeholders (verifies REQ:params-table-placeholders)

**Given** the URL `https://x.test/a?ref={order_id}&k=1`
**When** the user changes `k` to `2` in the Params table
**Then** the URL is `https://x.test/a?ref={order_id}&k=2` with the braces unencoded, and typing `{note}` in a new row's value leaves it as `{note}` flagged as undeclared.

### AC: not-required-semantics (verifies REQ:declare-parameters)

**Given** `https://x.test/r?a={a}&b={b}` with `a` required and `b` not required with default `7`
**When** the user runs with `a=1` and no value for `b`
**Then** the request is `https://x.test/r?a=1&b=7`; running with no value for `a` fails naming `a`; and declaring any parameter (in a query value, path segment, header or body) as not required with no default is refused on save.

### AC: required-missing (verifies REQ:declare-parameters, REQ:placeholder-semantics)

**Given** a required parameter with no value and no default
**When** the user runs
**Then** the run is blocked naming the parameter and nothing is sent.

### AC: json-string-body (verifies REQ:body-substitution)

**Given** `Content-Type: application/json` and body `{"ref":"{order_id}"}`
**When** `order_id` is `a"b\c`
**Then** the body is `{"ref":"a\"b\\c"}`.

### AC: json-bare-number-body (verifies REQ:body-substitution)

**Given** JSON mode, body `{"qty":{qty}}` and `qty` of type `integer` with value `3`, then `number` with value `NaN`
**When** the user runs
**Then** the first sends `{"qty":3}` and the second is rejected.

### AC: json-key-rejected (verifies REQ:body-substitution)

**Given** JSON mode and body `{"{k}":1}`
**When** the user saves
**Then** save is refused naming the object-key position.

### AC: form-body (verifies REQ:body-substitution)

**Given** `Content-Type: application/x-www-form-urlencoded` and body `a={v}`
**When** `v` is `x y&z`
**Then** the body is `a=x+y%26z`.

### AC: text-body (verifies REQ:body-substitution)

**Given** `Content-Type: text/plain` and body `note: {n}`
**When** `n` contains a line break
**Then** it is inserted verbatim in the body, while the same value in a header is rejected.

### AC: body-with-get-rejected (verifies REQ:body-substitution)

**Given** method GET and a body containing `{p}`
**When** the user saves
**Then** save is refused.

### AC: credential-parameter-isolated (verifies REQ:credentials-run-time-only)

**Given** parameter `token` used in `Authorization: Bearer {token}` and also in the URL, or given a `defaultValue`
**When** the user saves
**Then** save is refused; and with `token` used only in the credential header, a row, board or bag value is refused and a typed run-time value is accepted.

### AC: run-record-redaction (verifies REQ:credentials-run-time-only)

**Given** a run with a typed credential parameter and a row-bound `order_id`
**When** the result view shows the run's parameter line
**Then** the line holds both parameter ids and sources and the value of `order_id`, shows the credential as hidden, and no credential value appears in the line or in any saved query. (A run history does not exist yet; see Deferred.)

### AC: server-rejects-bad-template-input (verifies REQ:server-template-endpoint)

**Given** a template-mode request
**When** a placeholder has no supplied value, or a supplied id has no placeholder, or a value does not match its declared type
**Then** the server returns the structured 400 (`code` `http_template`, with `templateCode`, and `parameter` when plain) and makes no outbound request; and a rejected parameter id that is not plain is absent from the body.

### AC: body-limit-after-substitution (verifies REQ:server-template-endpoint)

**Given** a template body just under 256 KiB
**When** substitution makes the body exceed 256 KiB
**Then** the server rejects the request and sends nothing.

### AC: structured-error-copy (verifies REQ:server-template-endpoint, REQ:error-copy)

**Given** the server answers a run with `templateCode` `forbidden-position`, `parameter` `host` and `position` `host`
**When** the editor shows the failure
**Then** it reads "{host} can't be used in the web address's host. Use a separate query for each host." and shows no server text.

### AC: precedence-order (verifies REQ:binding-sources)

**Given** one parameter with a typed value, a row value, a board binding, a bag entry and a default
**When** sources are removed one by one from the top
**Then** the used value follows typed, row, board, bag, default in that order.

### AC: null-column-missing (verifies REQ:row-binding)

**Given** a bound row whose column for a required parameter is null
**When** the user runs
**Then** the parameter is a missing value and the run is blocked.

### AC: empty-value-is-missing (verifies REQ:placeholder-semantics)

**Given** a required parameter `q` with no default and an empty typed value
**When** the user runs
**Then** the run is blocked naming `q`, and nothing is sent.

### AC: set-bag-entry-ignored (verifies REQ:context-bag-binding)

**Given** a bag entry matching the parameter's `meta` whose value is a set
**When** the user runs
**Then** the entry is ignored and the next source, or a missing value, applies.

### AC: datetime-and-bit-rendering (verifies REQ:parameter-meta, REQ:type-coercion)

**Given** a `datetime` parameter with value `2026-03-04T23:30:00+02:00` and a `bit` parameter with value `true`
**When** they are substituted
**Then** the datetime renders `2026-03-04T21:30:00Z` and the bit renders `1`.

### AC: column-name-binding (verifies REQ:row-binding)

**Given** a row with a column `order_id` that has no meaning mapping, and parameter `order_id` with no `meta`
**When** the user runs from that row
**Then** the parameter binds from the column by case-insensitive name and the run panel shows source "row".

## Resolved decisions

Founder-approved on 2026-10-22, as recorded in the header of datatug-core `pkg/datatug/query_http_template.go`:

- **No fan-out.** One run binds one row (`multi-row-selection`). Running once per selected row waits for multi-value parameters and a per-row result table.
- **The CLI stays URL-only and GET-only.** Header and body placeholders and non-GET methods are web-only; the CLI reports such queries unsupported (`cli-parity`).
- **No brace escape.** The identifier-only expression keeps JSON bodies safe, and an escape would diverge from dalgo2http.
- **No host placeholders.** The host is fixed by the saved template, so the query's origin is pinned and no allowlist is needed. Use a separate saved query for each host.

## Deferred

- The board and card source of `binding-sources` item 3 ships with the board HTTP feature (`board-widget-deferred`). Until then the editor lists no board source and a board value is never supplied.
- A run history, and with it the redaction of its records, has not been built (`credentials-run-time-only`).
- The CLI change in `cli-parity` and its acceptance criterion `cli-rejects-non-url-placeholders`.

---
*This document follows the https://specscore.md/feature-specification*
