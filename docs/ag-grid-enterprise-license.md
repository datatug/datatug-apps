# AG Grid Enterprise license: runbook

Status: wiring is in place, **no license has been bought and no key is committed**. Until a key is configured the app
is a community-only build: no enterprise code is downloaded, no watermark, no console error.

## How it works

- `ag-grid-enterprise` and `ag-charts-enterprise` are dependencies (same version line as `ag-grid-community`:
  grid `36.2.0`, charts `14.2.0`).
- Nothing AG Grid runs at startup. `main.ts` only calls `configureAgGrid(AG_GRID_LICENSE_KEY)` (stores the string).
- Every `<ag-grid-angular>` carries the structural directive `*datatugAgGridReady` (`libs/datatug/ag-grid`, alias
  `@datatug/ag-grid`). It creates the grid only after the memoized `ensureAgGrid()` resolved:
  - Community modules are always registered (dynamic import of the community loader, already part of grid chunks).
  - With a non-empty key it also dynamically imports `ag-grid-enterprise-loader.ts` (a lazy ~3.9 MB / ~850 kB gzip
    chunk), registers `AllEnterpriseModule.with(AgChartsEnterpriseModule)` (row grouping, aggregation, pivot, side
    bar/tool panels, Excel export, integrated charts) and calls `LicenseManager.setLicenseKey`. The key is never
    logged; a load failure falls back to community with a generic warning.
  - Pages with no grid never trigger any of it, so the enterprise chunk is requested only on a page that creates a grid.
- `agGridEnterpriseEnabled()` (a readonly signal) flips to `true` after `ensureAgGrid()` resolved with a key. Grids read
  it to switch on enterprise-only options, e.g. `[sideBar]="agGridEnterpriseEnabled() ? 'columns' : false"`.
- New grids must use `*datatugAgGridReady` on `<ag-grid-angular>`; every current grid (including the query result page) does.
- The build-time variable is `AG_GRID_LICENSE_KEY`. `tools/stamp-ag-grid-license.mjs` (Nx target
  `datatug-app:stamp-ag-grid-license`, a dependency of `build` and `serve`) writes the gitignored
  `apps/datatug-app/src/ag-grid-license.generated.ts`, which Angular `fileReplacements` swaps in for the committed
  `ag-grid-license.ts` (always an empty string). Same pattern as `build-info`.

## After the founder buys a license (steps)

1. Buy the Enterprise license (AG Grid, or the Enterprise Bundle if integrated charts are wanted: AG Charts Enterprise
   is a separate product that the bundle includes) at <https://www.ag-grid.com/license-pricing/> and copy the license
   key from the AG Grid account.
2. Production: GitHub, repo `datatug/datatug-apps` > Settings > Secrets and variables > Actions > **Variables** >
   New repository variable `AG_GRID_LICENSE_KEY` = the key. (A variable, not a secret: GitHub Actions cannot pass a
   secret into the shared `cf-deploy` workflow's `build-command`, and an AG Grid key is shipped inside the public
   JavaScript bundle by design. The deploy job log shows the build-command line including the value.)
3. Re-run the `deploy` workflow (or push to main). CI's `build` job reads the same variable.
4. Local development: create `.env.local` (gitignored) in the repo root with `AG_GRID_LICENSE_KEY=<key>`, or export the
   variable, then `pnpm nx serve datatug-app`. The stamp step prints only "key configured", never the key.
5. Verify: open a grid page on the deployed site. In DevTools > Network the lazy `chunk-*.js` of about 3.9 MB loads;
   Console shows no AG Grid license error; the grid shows no "AG Grid Enterprise License" watermark. With the variable
   unset, none of that chunk loads.
6. Enterprise options are off until a grid opts in via `agGridEnterpriseEnabled()`. The results grid
   (`sneat-datatug-results-grid`, below) does, so a configured key turns its enterprise features on with no other change.

To remove: delete the variable; the next build is community-only again.

## The results grid (`sneat-datatug-results-grid`)

One grid component draws query results on the query page (a live run and a stored result opened in the editor) and on
the query result page (`libs/datatug/main/src/lib/components/results-grid/`). Columns come from `resultColumnDef()`
(type-aware), cells are text or `null`. Without a key it passes AG Grid nothing that needs an enterprise module: the
founder decided (2026-10-16) not to buy a license for now, so the **community grid is the target** and every feature
below the first table works with no key.

### Community features in use (verified against the AG Grid 36.2 docs on 2026-10-16)

| Feature | How | Source |
| --- | --- | --- |
| Sorting on every column (numbers by value, dates by time, wide integers exactly), sort indicator on every header | `sortable`, `unSortIcon`, comparators in `results-grid-columns.ts` | Community (`ag-grid-community`) |
| Column filters by kind (text, number, date) and floating filters; quick filter box with "n of m rows" | `filter`, `floatingFilter`, `quickFilterText` | Community |
| Resize, move, pin; widths fitted to content within min/max | `resizable`, `autoSizeStrategy: fitCellContents`, `ColumnAutoSizeModule` | Community; [column sizing](https://www.ag-grid.com/angular-data-grid/column-sizing/), [column pinning](https://www.ag-grid.com/angular-data-grid/column-pinning/) |
| **Column chooser** (toolbar popover: show/hide checkboxes, Show all, move up/down, Pin, Reset columns) | `api.setColumnsVisible`, `api.moveColumns`, `api.setColumnsPinned`, `api.resetColumnState` | Community column API ([column state](https://www.ag-grid.com/angular-data-grid/column-state/), `ColumnApiModule`) |
| **Remembered layout** per context (visibility, order, width, pinned, sort) and the density | `api.getColumnState` / `api.applyColumnState`, saved to `localStorage` | Community ([column state](https://www.ag-grid.com/angular-data-grid/column-state/)) |
| **Autosize all** | `api.autoSizeAllColumns()` | Community (`ColumnAutoSizeModule`, `ag-grid-community`) |
| **Row selection with a checkbox column** | `rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false }` | Community ([multi-row selection](https://www.ag-grid.com/angular-data-grid/row-selection-multi-row/): examples register `RowSelectionModule` from `ag-grid-community`) |
| **CSV export of the selected rows** (all rows when none is selected) | `exportDataAsCsv({ onlySelected, columnKeys, processCellCallback })` | Community ([CSV export](https://www.ag-grid.com/angular-data-grid/csv-export/): "Community version supports api CSV Export") |
| **Copy selected rows** (tab-separated, with a header line) | Own code: `navigator.clipboard.writeText` over the selected rows | Replaces the enterprise clipboard feature (below) |
| **Density** (compact 28 px / the theme's comfortable rows) | `rowHeight`, `api.setGridOption`, `api.resetRowHeights` | Community |
| **Tooltips**: the full text of a cell that probably does not fit, and the name and type of a column in its header | `tooltipValueGetter`, `headerTooltip`, `tooltipShowDelay` | Community ([tooltips](https://www.ag-grid.com/angular-data-grid/tooltips/): `TooltipModule` from `ag-grid-community`) |
| Number formatting (thousands separators, not for identifiers); right-aligned numbers; locale dates; check marks for booleans; compact JSON; dimmed `null` | `valueFormatter`, column types in `results-grid-columns.ts` | Community |
| Row-number column (pinned), `$key` kept out of sight | `ROW_NUMBER_COLUMN`, `hide` + `suppressColumnsToolPanel` | Community |
| Native text selection for copy of a cell; column hover highlight; row virtualization | `enableCellTextSelection`, `columnHoverHighlight` | Community |
| Keyboard navigation | see below | Community behaviour (the keyboard page labels only the range/clipboard keys with enterprise modules) |

Not on, on purpose: **AG Grid pagination** (`PaginationModule` is community, but the query page pages the result itself
with Previous/Next and shows the grid one page at a time, so there is no page-size selector in the grid).

### Enterprise-only (what a license key would add; none is needed for the above)

| Feature | Notes |
| --- | --- |
| **Column menu** (the header menu button and the right-click menu: pin, auto-size, "Choose columns", "Reset columns", row group) | [Column menu](https://www.ag-grid.com/angular-data-grid/column-menu/) is marked Enterprise and says the community grid has no menu. `suppressMenuHide` and the legacy tabbed menu are enterprise too. The custom column chooser (toolbar "Columns" button) replaces what the menu gave: pin, show/hide, reset, and the toolbar adds "Autosize". |
| **Columns tool panel** (side bar) | [Columns tool panel](https://www.ag-grid.com/angular-data-grid/tool-panel-columns/) is Enterprise (`ColumnsToolPanelModule` from `ag-grid-enterprise`). Only on with a key: `sideBar` is passed only while `agGridEnterpriseEnabled()`. The community chooser makes the same job possible with no key. |
| Filters tool panel, status bar, row grouping and aggregation, pivot, range (cell) selection, integrated charts, Excel export | Enterprise modules; passed only while `agGridEnterpriseEnabled()` is true. |
| Clipboard: Ctrl+C of a cell range, `copySelectedRowsToClipboard`, paste | [Clipboard](https://www.ag-grid.com/angular-data-grid/clipboard/) is Enterprise (`ClipboardModule`). The community grid copies a cell's text natively (`enableCellTextSelection`) and "Copy selected" above copies whole rows. |
| Context (right-click) menu | Enterprise (`ContextMenuModule`). |

With a key the enterprise features are added on top (the chooser stays; the side bar's columns panel duplicates it).

Verified: no enterprise option is passed to the grid while `agGridEnterpriseEnabled()` is false (unit spec with a mocked
loader), and the enterprise chunk is requested only when `AG_GRID_LICENSE_KEY` is set. The community features above were
exercised in Chromium against a real `datatug` daemon (`apps/datatug-app/e2e/agent-links/results-grid.spec.ts`). The
enterprise side was only exercised with a mocked flag; no key has been used.

### Keyboard (community behaviour, checked in `results-grid.spec.ts`)

Arrow keys move the focused cell; Tab and Shift+Tab move to the next/previous cell; Page Up/Down and Home/End scroll
by a page / go to the first or last row; **Space toggles the checkbox of the focused row** (verified by the e2e).
Text selected in a cell with the mouse copies natively (`enableCellTextSelection`); the keyboard copy of a focused cell or range is enterprise. Enter does not start editing (the cells are
read-only) and nothing else is bound to it. In the query editor the **Current row** is the focused or clicked row
(it follows the arrow keys), shown in the Current row pane (its "Current row" toggle opens it); the checkboxes select
rows for export and copy only and never move the Current row. Arrow keys on a header move focus; Enter on a header
sorts.

### Remembered layout and privacy

Per context the grid stores, under `datatug.grid.v1:<project id>:<saved query id | stored result id | source id>:<query|result|source>`
(each part percent-encoded), one small JSON: `v`, `density`, `sig` (a 32-bit hash of the column ids, names and types)
and, once the person changed the layout, `cols` (per column id: `hide`, `width`, `pinned`, `sort`, `sortIndex`).
**Never stored: a row value, a filter value, the quick-filter text, a query or prompt text, a link code.** The
remembered layout is ignored (the density is kept) when the columns no longer match its `sig` and ids. Reads and
writes are wrapped in try/catch (private window, blocked storage, quota): a failure only means nothing is remembered.
"Reset columns" (column chooser) forgets the layout and fits the columns again.

## License facts (from ag-grid.com, 2026-10-16; check the EULA before relying on them)

Sources: <https://www.ag-grid.com/angular-data-grid/license-install/>, <https://www.ag-grid.com/angular-data-grid/licensing/>,
<https://www.ag-grid.com/license-pricing/>, <https://www.ag-grid.com/angular-data-grid/modules/>,
<https://www.ag-grid.com/angular-data-grid/integrated-charts-installation/>.

- Community is MIT-licensed and free. Enterprise needs a commercial EULA license for production use.
- Licenses are per developer (the site does not define "developer" in the pages read; check the EULA) and per
  deployment; perpetual, including one year of support and updates.
- Without a key, Enterprise shows a watermark and a console error. "You can test AG Grid Enterprise locally without a
  licence." The pages read do not state exactly how localhost/dev hosts are treated nor distinguish development vs
  deployment keys: ask AG Grid support before assuming either.
- A free 30-day Enterprise Bundle trial license (grid + charts, no watermark) can be requested from the pricing page. It
  can be set as `AG_GRID_LICENSE_KEY` to try the features.
- Register enterprise modules first, then `LicenseManager.setLicenseKey(...)`. Integrated charts need
  `AllEnterpriseModule.with(AgChartsEnterpriseModule)` from `ag-charts-enterprise`.
- Prices are not repeated here; see the pricing page.
