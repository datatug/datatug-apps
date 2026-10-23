# MeaningGraph logical DataModels

The project menu's **Data models** route browses logical structure from one
reviewed MeaningGraph catalog. It works without semantic definitions or a database
connection. Physical `dbmodels`, query execution and representation eligibility
remain separate contracts.

The reader defaults to the reviewed public `meaninggraph/registry` catalog at
published commit `4865a0351c49283dcc1eac2c963f677e6ad30bd0`, path
`catalog.json`, with exact-byte SHA-256
`f4103c609d1d8fc2422b854d3a2652b138ad7836fb28247e8576f3459013f631`.
The published catalog contains 9 models, 11 graphs and 22 retained revisions.
Constructing the service or creating a list observable does not fetch anything;
reads begin only when the observable is subscribed.

Applications can override `MEANINGGRAPH_CATALOG_PIN` with another reviewed
`ImmutableFile`, including a fixture pin in tests. To disable browsing explicitly:

```ts
{ provide: MEANINGGRAPH_CATALOG_PIN, useValue: null }
```

The token is exported by
`libs/datatug/main/src/lib/logical-models/native-data-models.service.ts`.
Without an override, the published default is active. An explicit `null` provider
makes the page explain that no reviewed catalog is configured and performs no
external reads.
List routes select current models; detail routes retain the publisher's exact
source commit in `data-models/:modelId/versions/:commit`. A missing historical
revision fails instead of falling back to the current model.

The catalog and all dependent receipts/artifacts come from the same immutable
shared-registry Git tree. Referenced byte hashes, source identity and exact module
locks are checked. Fields are derived from original JSON ASTs, preserving keyless
records, components, enums, own-field overrides, multiple inherited origins and
lossless numeric constraints. Optional semantic graphs are not fetched for model
browsing. Producer-side reference validation remains responsible for HCL/JSON
equivalence and logical digest calculation; the browser verifies retained bytes
and the normalized JSON view without executing publisher code.

Reads cancel when routes change and fail explicitly on deadline, input/file or
composition limits. They perform no writes and do not grant a model-only resource
eligibility to execute a representation query.

Focused validation:

```sh
pnpm nx run datatug-main:test-focused --testFiles=libs/datatug/main/src/lib/logical-models/native-data-models-reader.spec.ts,libs/datatug/main/src/lib/logical-models/native-data-models.service.spec.ts,libs/datatug/main/src/lib/pages/signed-in/logical-models/data-models-page.component.spec.ts
```

Update the default or an application override only after the replacement
shared-registry commit is published and its bytes independently reconciled. For
rollback, restore a prior reviewed pin or provide `null` to disable browsing.
Removing an override restores the published default; it does not disable browsing.
Retain all newly published model revisions in storage.
