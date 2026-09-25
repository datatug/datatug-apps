# DataTug Embed

Framework-neutral `<datatug-grid>` and `<datatug-chart>` web components. The
standalone ES module has no Angular or Ionic runtime dependency. Build with
`pnpm nx run datatug-embed:build`; the browser asset is
`dist/libs/datatug/embed/datatug.js`. The output directory also contains an
`@datatug/embed` npm package manifest for a future package release. Until a
package/CDN release exists, copy the built asset to the host site and serve it
as JavaScript with a stable, versioned URL.

## Static data

```html
<script type="module" src="/embed/datatug.js"></script>
<datatug-grid data-url="/data/json/chinook.Album.json"></datatug-grid>
```

`data-url` accepts a plain JSON array of objects, `{ "rows": [...] }`,
`{ "data": [...] }`, OVDB `{ "records": [{ "key": "...", "data": {...} }] }`,
or a CSV file with a header. Format detection checks HTTP `Content-Type`, then
the URL extension, then an optional `format="json|csv"` fallback. The grid
shows loading, empty, and error states; sorts columns, filters rows locally,
and renders 50 rows per page by default (`page-size` can be 1–500). Search,
sort, and paging operate on the loaded result, so the source should bound the
result size. Returned values are written with `textContent`, never HTML.

## OVDB and DTQL

```html
<script type="module" src="/embed/datatug.js"></script>
<datatug-grid connection="https://chinookdb.com/ovdb/dbs/chinook">
  <dtql-query>
from: {name: Album}
where: {op: '==', left: {field: ArtistId}, right: {param: ArtistID}}
limit: 10
  </dtql-query>
  <dtql-param name="ArtistID" type="number" value="1"></dtql-param>
</datatug-grid>
```

The connection is the canonical HTTPS database identity and a normal browser
page. The component requests `/.well-known/openvaultdb` on its origin, finds
the exact database URL, requests that entry's `apiUrl`, and uses only the
advertised `endpoints.dtql`. The metadata must advertise
`capabilities.dtql: true` and `queryFormat: "dtql-yaml+json"`. The component
POSTs `{ "query": "<DTQL YAML>", "parameters": {"ArtistID": 1} }` as JSON.
Parameters are separate typed values; the client never substitutes query text.
The endpoint must bind parameter expression nodes safely. An endpoint that
advertises `queryFormat: "dtql-yaml"` receives the raw YAML body and cannot
accept bound parameters through this component.

This browser discovery/metadata shape is currently implemented by the
ChinookDB OVDB adapter. The existing OpenVaultDB Go server exposes a thinner
well-known document and raw YAML DTQL endpoint; it needs the advertised
database/API links and capability metadata before the embed can connect to it
by canonical URL. The component does not guess a database ID or API path.

The child query must be valid current YAML-native DTQL. One nonempty
`<dtql-query>` is required. `<dtql-param>` names are passed through unchanged,
and must be unique and nonempty. Its `value` attribute defaults to a string;
`type="number|boolean|null|string"` parses attributes. The DOM property
`param.value = 456` accepts a string, number, boolean, or null and overrides the
attribute until `value` or `type` changes. Query text, parameter changes,
`connection`, `data-url`, `format`, `type`, and `page-size` changes refresh
automatically. Call `grid.refresh()` or `grid.reload()` explicitly if source
data changes at the same URL. Each refresh cancels the previous request.

`connection` and `data-url` are mutually exclusive. A direct source cannot
contain DTQL children. Bad configuration, unsupported capability, HTTP errors,
and cross-origin failures appear in the component and emit `datatug-error`
with `{message}`. A successful load emits `datatug-data-loaded` with
`{rows,columns,metadata}`. Clicking a grid row, or focusing it and pressing
Enter/Space, emits `datatug-select` with `{row,index,key}`. These events bubble.

## Chart MVP

```html
<datatug-chart type="auto" data-url="/data/json/totals.json"></datatug-chart>
```

The chart uses the same two source modes and lifecycle. `auto` and `bar` render
a compact bar chart from the first numeric and first other column, up to 20
rows. A dataset without that shape shows a clear error. Future chart types can
extend this contract without changing source handling.

## Host styling and security

The shadow DOM respects `--datatug-bg`, `--datatug-fg`, `--datatug-muted`,
`--datatug-border`, `--datatug-header-bg`, `--datatug-hover`,
`--datatug-selected`, `--datatug-accent`, `--datatug-error`,
`--datatug-button-bg`, `--datatug-font`, `--datatug-radius`, and
`--datatug-max-height`. The defaults are light and fit ChinookDB.

Source and advertised endpoint URLs must use HTTP(S) and may not contain
embedded credentials. Browser fetches use same-origin credentials only.
Cross-origin OVDB and static endpoints must enable CORS for the host origin,
methods, and headers they expose. The host CSP must allow the script source
and relevant `connect-src` origins. Do not put bearer tokens or secrets in
component attributes, query URLs, or publicly served HTML. Public read-only
OVDB databases do not require a DataTug account; an authenticated endpoint
needs its own safe credential flow outside this MVP.
