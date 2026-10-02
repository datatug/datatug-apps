# Fixture: Chinook sales per capita

Test data for `federated-query-chinook-sales-per-capita.spec.ts`: the saved hero
query `sales/chinook-sales-per-capita` and the rows of the three sources it
joins. It is a faithful copy, not a sample: every row the query can reach is here
(412 invoices, 24 country aliases, 24 population records), so the spec can compare
against the full result of the Go CLI.

| File | Source | Changes |
| --- | --- | --- |
| `chinook-sales-per-capita.query.dtql`, `.query.json` | `datatug/datatug-demo-projects`, `demo-project-1/queries/sales/`, `origin/main` at `0e5b98f86f37f00a3c3be5bbbb515d15620c63c6` (CC0 1.0) | none |
| `country_aliases.json` | `demo-project-1/data/geo/country_aliases/$records/*.json`, same commit (hand-checked mapping data, CC0 1.0) | one file per record merged into `{key, data}` entries; `data` is verbatim |
| `population_wb.json` | `demo-project-1/data/geo/population_wb/$records/*.json`, same commit | the 24 records the aliases point at, merged as above; `data` is verbatim |
| `invoice.json` | Chinook SQLite, `datatug/chinook-database` revision `6334395117e2478a2712e083be614721341c26c9`, table `Invoice` | only the columns the query declares (`InvoiceId`, `BillingCountry`, `Total`); `key` is `InvoiceId` as text, as OVDB serves it |

## Attribution

- **World Bank Open Data** (`population_wb.json`): indicator SP.POP.TOTL,
  "Population, total", data (c) The World Bank, made available under
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
  Modified: only the most recent observation per country, re-keyed by ISO 3166-1
  alpha-2 code, by `cmd/wb-import` in `datatug-demo-projects`. The World Bank does
  not endorse this data or its changes. Each record's `source_url` is the World
  Bank API call that returns it.
- **Chinook Database** (`invoice.json`): Copyright (c) 2008-2017 Luis Rocha, MIT
  license; see `LICENSE.md` in `datatug/chinook-database`.
