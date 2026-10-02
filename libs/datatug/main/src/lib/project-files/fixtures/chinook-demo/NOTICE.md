# Notice: third-party material in this fixture

The project files here (queries, mappings, models, prepared questions, the `web` environment) are
CC0 1.0, as `datatug/datatug-demo-projects`. The material below is **not** covered by tha
dedication; each part keeps its own licence and requires the attribution given here.

## Chinook (`external/chinookdb.com/data/json/chinook.Invoice.json`)

The invoice rows are from the Chinook sample database, created by Luis Rocha (upstream
<https://github.com/lerocha/chinook-database>, revision `7f67772503d71ba90f19283c38e93923addb43fa`),
as hosted by <https://chinookdb.com>. ChinookDB.com is an independent hosted resource and is no
the official upstream project. Chinook is licensed under the MIT licence; the notice below is the
upstream `LICENSE.md` at that revision, copied (trailing spaces at line ends removed), not retyped:

```
Chinook Database
--------------------------------------
Copyright (c) 2008-2024 Luis Rocha

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## World Bank population and GeoNames (`data/geo/.web/`)

`data/geo/.web/population_wb.json` holds World Bank figures (indicator SP.POP.TOTL, "Population,
total", copyright The World Bank, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)),
modified: only the most recent observation per country is kept, rows are re-keyed by ISO 3166-1
alpha-2 code, and the records are merged into one file. The World Bank does not endorse this
project or the changes made to its data. `data/geo/.web/country_aliases.json` is hand-checked
mapping data with no third-party content. The full statement, including GeoNames (CC BY 4.0,
derived and modified), is in [`data/geo/DATA-LICENSE.md`](data/geo/DATA-LICENSE.md), copied
unchanged from `datatug/datatug-demo-projects` at `0e5b98f86f37f00a3c3be5bbbb515d15620c63c6`.
