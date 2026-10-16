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

One grid component draws query results on the query page and on the query result page
(`libs/datatug/main/src/lib/components/results-grid/`). Columns come from `resultColumnDef()` (type-aware), cells are text
or `null`. Without a key it passes AG Grid nothing that needs an enterprise module.

| Feature | Edition |
| --- | --- |
| Sorting on every column (numbers by value, dates by time, wide integers exactly) | Community |
| Column filters by kind (text, number, date) and floating filters | Community |
| Resize, move, pin and auto-size (column menu); widths fitted to content within min/max | Community |
| Row-number column (pinned) | Community |
| Numbers right-aligned; locale dates; check marks for booleans; compact JSON; dimmed `null` | Community |
| Quick filter box with a "n of m rows" count | Community |
| CSV export | Community |
| Native text selection for copy, keyboard navigation, row virtualization, tooltips | Community |
| Row grouping and aggregation, pivot (enabled per column) | Enterprise |
| Side bar tool panels (columns, filters) and status bar (row counts, aggregation of a range) | Enterprise |
| Range (cell) selection | Enterprise |
| Integrated charts | Enterprise (with `ag-charts-enterprise`) |
| Excel export (extra toolbar button) | Enterprise |

Verified: no enterprise option is passed to the grid while `agGridEnterpriseEnabled()` is false (unit spec with a mocked
loader), and the enterprise chunk is requested only when `AG_GRID_LICENSE_KEY` is set. The enterprise side was only
exercised with a mocked flag; no key has been used.

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
