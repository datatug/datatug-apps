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

The shared placeholder contract is the one the CLI already implements through dalgo2http (`datatug-cli/pkg/httpsource/params.go:11` and `:49-59`; `dal-go/dalgo2http` `descriptor.go:120`, `request.go:29-62`, `config.go:186-199`). This feature extends it from the URL to headers and body and does not change what the URL means, so no saved query needs migrating.

### Placeholder contract

#### REQ: placeholder-syntax

A placeholder is `{name}` where `name` matches `[a-zA-Z0-9_]+` (the dalgo2http and CLI expression `\{([a-zA-Z0-9_]+)\}`). `{{name}}`, `:name`, `$name` and `${name}` are NOT placeholders. There is no escape for a literal `{name}`; text that must contain braces uses JSON objects (`{"`), which never match. Placeholders are allowed only in: URL path segments, URL query-string values (including a value fragment such as `ref=ord-{id}`), header values and the body. They are NOT allowed in the scheme, userinfo, host or port, the fragment, a query-string name, a header name or the method; such a template is invalid.

#### REQ: placeholder-semantics

Substitution is a single pass over the template: substituted text is never rescanned, so a value containing `{other}` is inserted literally. A placeholder with no resolved value fails the run with a missing-value error naming the parameter (the dalgo2http `ErrMissingParam` behavior, `request.go:53-56`); it is never sent empty or left as `{name}`. Every placeholder in the template appears in the query's declared parameters, and every declared parameter appears as a placeholder in at least one position; the CLI already rejects both mismatches (`params.go:41-59`) and the web app MUST apply the same rule on save. Extra declared query-string parameters are NOT appended automatically (the dalgo2http append behavior at `request.go:77-86` is unreachable from the CLI because of the same rule, and is not adopted).

#### REQ: legacy-literal-braces

A saved HTTP query with no declared parameters keeps running literally, byte for byte, as today. When such a query's template contains a `{name}` placeholder, the editor MUST warn, without blocking save or run, that it looks like a placeholder and offer to declare it. Once a query declares at least one parameter, the rules of `placeholder-semantics` are strict and blocking.

### Declaring parameters

#### REQ: declare-parameters

An HTTP query MAY declare `QueryDef.Parameters` using the existing `ParameterDef` shape (`id`, `type`, `title`, `defaultValue`, `isRequired`, `meta`) with these rules: `id` is the placeholder name and matches the placeholder syntax; ids are unique; `type` is one of `string`, `integer`, `number`, `boolean`, `bit`, `date`, `datetime`; `isMultiValue`, `lookup`, `minLength` and `maxLength` are rejected on HTTP queries in this version; `defaultValue` must match `type` per the existing `ParameterDef.Validate`. `isRequired` defaults to false; a parameter that is neither required nor defaulted and has no value at run time is a missing value (`placeholder-semantics`). The editor shows a Parameters section that lists every placeholder found in the template, lets the user add the declaration with one action, and flags declared-but-unused parameters.

#### REQ: parameter-meta

A parameter MAY carry `meta: {entity, field}` (the existing `EntityFieldRef`), naming a meaning in the project's meaning graph such as `Order.id`. `meta` has no effect on substitution; it is the key used to bind values from a selected row or the context bag (`binding-sources`). The reserved type `bit` renders as `0`/`1`, `boolean` as `true`/`false`, `integer` in decimal, `number` in shortest decimal form without an exponent, `date` as `YYYY-MM-DD`, `datetime` as RFC 3339 UTC.

### Binding

#### REQ: binding-sources

A parameter value is resolved from the first source that supplies one, in this precedence: (1) a value typed in the run panel for this run; (2) the selected row(s) of the query result the run was launched from; (3) a board or card parameter binding (`WidgetParameterBinding`: constant `value` or `boardParameterId`), defined here but delivered by the later board feature (see Out of scope); (4) a session context bag entry whose subject matches the parameter's `meta`; (5) the declared `defaultValue`. A required parameter with no value blocks the run and shows an inline input for it; nothing is sent.

#### REQ: row-binding

From a query result grid, a "Run HTTP query" action for the selected row lists saved HTTP queries whose declared parameters can be bound from that row. A parameter binds to a column of the row when (in order): the column's meaning-graph mapping equals the parameter's `meta` (`entity.field`), reusing the ranking of [Project cards](../project-cards/README.md) `input-matching`; the column name equals the parameter id, case-insensitively; or the user picked the column in the run panel. A null column value is a missing value. For the worked example, a selected row with columns `OrderRef` (mapped to `Order.id`) and `ShippedOn` binds `order_id` and `as_of`.

#### REQ: multi-row-selection

A run binds from exactly one row. When several rows are selected the action is disabled with the reason "select one row", and no request is sent; the editor never runs once per row and never merges rows. Multi-value parameters and fan-out over rows are a later feature (see Open questions).

#### REQ: context-bag-binding

A context bag entry supplies a value only when its subject's concept and field equal the parameter's `meta` and its value is a scalar; a set-valued entry is ignored for HTTP queries. The run panel shows where each value came from (typed, row, bag, default) and lets the user override any value for this run only. Overrides are not saved to the query and not written to the bag.

#### REQ: type-coercion

A bound value is coerced to the parameter's `type` before substitution, and a value that cannot be coerced blocks the run with an error naming the parameter and the value's source, never a silent fallback. A `datetime` value bound to a `date` parameter is truncated to its UTC calendar date. Date and time values come only from a bound source or the business clock entry the project places in the context bag; the wall clock is never supplied implicitly, so the same bound inputs always produce the same request. In the worked example `as_of` is `date`; a row value `2026-03-04T23:30:00Z` becomes `2026-03-04`.

### Substitution and safety

#### REQ: encoding-per-position

Values are encoded for the position they land in: a URL path segment uses `url.PathEscape` semantics (so `/` becomes `%2F`) and a value of exactly `.` or `..` is rejected; a URL query value uses `url.QueryEscape` semantics (the CLI behavior, `request.go:57-60`); a header value is inserted as is after the line-break check below; a body is substituted per `body-substitution`. Position is decided by where the placeholder sits in the template, so the query-string/path split matches `params.go:30-33` except that a placeholder before the first `?` and inside the authority is rejected by `placeholder-syntax`.

#### REQ: header-injection

After substitution, a header value containing CR, LF or NUL is a run error naming the header and the parameter. Characters are never stripped or escaped to make the value pass. Header names and the method cannot contain placeholders, so a value cannot add a header.

#### REQ: body-substitution

When the request's `Content-Type` is JSON (`application/json` or `+json`) or the trimmed body starts with `{` or `[`, the body is treated as JSON text: a placeholder inside a JSON string literal receives the value JSON-string-escaped without added quotes; a placeholder outside any string literal is allowed only for `integer`, `number`, `boolean` and `bit` parameters and is inserted as a JSON literal; a `string`, `date` or `datetime` parameter outside a string literal is rejected. A value therefore can never add, close or reorder JSON structure. For `application/x-www-form-urlencoded` a value uses query-value escaping. Any other body is text and the value is inserted as is. A body placeholder in a method that carries no body is rejected on save.

#### REQ: credentials-run-time-only

Saved templates and `defaultValue` fields pass the existing embedded-secret screen (`embeddedCredentialReasonWithoutDSN`) and credential headers are still never saved (`credential-headers-unsaved`). A placeholder in the URL userinfo is rejected. A credential header (per `isCredentialHTTPHeader`) may use a placeholder only in the session-only editor value, and its parameters accept a typed value only: a value bound from a row, board or the context bag is refused for a credential header so that data cannot flow into authentication. Parameter values are not written to run logs or query history with the credential header's resolved value; history keeps parameter ids and sources, and values only for non-credential parameters.

#### REQ: substitution-location

Substitution is performed by one shared implementation with the same results in both places: in the browser for "Run via Browser" and on the server for "Run via DataTug server". The server never trusts a client-substituted URL as template output: in template mode it substitutes itself, so the SSRF guard (public http(s) only, redirects re-checked, credential headers stripped cross-host) always evaluates the FINAL URL, and the guard result for a template run equals the result for the same literal URL.

#### REQ: server-template-endpoint

`POST /v0/datatug/http/run` keeps accepting a literal request unchanged. A request that carries a `parameters` field, even an empty array, is in template mode: `url`, `headers` and `body` are templates, `parameters` is a list of `{id, type, value}` (the existing `datatug.Parameter` shape) with scalar values, and the server applies `placeholder-syntax` through `body-substitution`. In template mode a placeholder without a supplied value, a supplied id with no placeholder, an invalid type or value, or a rejected position returns a 400 naming the parameter; no outbound request is made. Existing limits (256 KiB request body, 50 headers) apply to the substituted request.

#### REQ: cli-parity

The CLI keeps its GET-only, URL-only behavior and its current placeholder, escaping and error semantics unchanged. An HTTP query that uses placeholders in headers or the body, or a method other than GET, is valid in the web app and is reported by the CLI as unsupported for that query (never run with unsubstituted placeholders). A query whose placeholders sit only in the URL path or query values and whose method is GET runs identically in the CLI and the web app for the same values.

#### REQ: preview

The editor shows the resolved request (final URL, header values with credential values masked, body) for the current values before and after a run, marks each substituted segment with its source, and keeps the template as the only saved form.

### Out of scope / later

#### REQ: board-widget-deferred

This feature does not add a board HTTP editor or make the new-card-dialog "HTTP request" card type reachable, and does not change `HTTPRequest` in `widget-http.ts`. Reason: that widget carries its own inline `url`, `headers` and `parameters` and is a different model from a saved HTTP query; reaching it requires choosing between binding a saved HTTP query (as `SQLWidgetSettings` does) and keeping an inline request, which is a separate decision with its own card and dashboard acceptance criteria. The board binding of `binding-sources` item 3 is specified as a contract only and becomes testable when that feature ships. Until then the card type stays unlisted or marked unavailable and is not extended.

## Dependencies

- http-query-editor

## Acceptance Criteria

### AC: url-template-shared-with-cli (verifies REQ:placeholder-syntax, REQ:placeholder-semantics, REQ:cli-parity)

**Given** a GET query `https://carrier.example/v1/shipments?order_ref={order_id}&as_of={as_of}` with parameters `order_id` and `as_of`
**When** it runs from the web app and from the CLI with `order_id=A/1 2` and `as_of=2026-03-04`
**Then** both send `https://carrier.example/v1/shipments?order_ref=A%2F1+2&as_of=2026-03-04`.

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
**Then** the first is stopped by the SSRF guard exactly as the same literal URL would be, with no request to the private address, and the second returns 400 naming the host position.

### AC: literal-request-unchanged (verifies REQ:server-template-endpoint)

**Given** a request to `/v0/datatug/http/run` with no `parameters` field and a URL containing `{x}`
**When** the server runs it
**Then** the URL is sent literally as today.

### AC: cli-rejects-non-url-placeholders (verifies REQ:cli-parity)

**Given** a saved POST query with a body placeholder
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

## Open Questions

- **Run once per selected row (fan-out)?** Recommend no for v1 (`multi-row-selection` rejects it); revisit with multi-value parameters and a per-row result table.
- **Should the CLI also run header/body placeholders and non-GET methods?** Recommend no; dalgo2http is read-only GET-only by design, so the CLI reports such queries unsupported.
- **Literal braces escape (`{{`/`\{`)?** Recommend none; the identifier-only expression makes JSON bodies safe, and an escape would diverge from dalgo2http.
- **Should a placeholder be allowed in the host for per-tenant APIs?** Recommend no (SSRF); use a different saved query per host.

---
*This document follows the https://specscore.md/feature-specification*
