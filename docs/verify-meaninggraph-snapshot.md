# Verify a local MeaningGraph snapshot with the DataTug reader

`tools/verify-meaninggraph-snapshot.mjs` exercises the delivered browser reader
against an explicit local checkout of the shared registry. It lists and reads
**every selected model** using `listNativeDataModels` and `readNativeDataModel`.
When Chinook is selected, it also checks all 11 exact record names and the
`Album.ArtistId` reference to `Artist` at its exact source commit.

Use Node 24+, Git 2.45+ and the existing installed Vite dependency. No package
installation, application server, browser, database or external service is needed.
Invoke Node directly so a package manager cannot automatically install packages.
From the DataTug repository root:

```sh
node tools/verify-meaninggraph-snapshot.mjs \
  --catalog /absolute/path/to/meaninggraph-registry/catalog.json \
  --source-sha <full-lowercase-40-character-local-Git-commit> \
  --catalog-sha256 <SHA256-of-the-exact-catalog.json-bytes>
```

Provide a reviewed commit and byte digest explicitly. The command requires that
checkout's HEAD to match the supplied commit and the catalog to be at its root.
It verifies each served file against that exact Git tree, including regular-file
mode and exact blob bytes. Files must have safe declared relative paths, remain
inside the checkout, and contain no symlink components. Caller Git overrides,
replace objects and lazy network fetching are disabled.

The transport accepts only immutable URLs under
`https://raw.githubusercontent.com/meaninggraph/registry/<supplied-commit>/` and
serves them from that local snapshot. Global fetch is disabled. Semantic receipt
and definition requests are rejected; catalog/index graph metadata may still be
present. The actual reader verifies retained hashes, original/native ASTs and
exact model dependency closure. The tool executes no database queries and writes
only an ephemeral Vite cache in a temporary scratch directory, removed on exit.
It loads the reader through Vite SSR without loading the application's Vite
configuration, environment files, build scripts or install lifecycle.

Success prints JSON with each model's source commit and record/field counts, the
shared source Git SHA, catalog byte SHA256, reader source SHA256, transport counts
and zero semantic receipt reads. Failures exit nonzero. The output is explicitly
**LOCAL_FIXED_URL_MOCK_FETCH** evidence. It does not establish that the commit or
catalog is published, verify remote availability, activate an application pin,
or grant representation query eligibility. Configure a production catalog pin
only after its publication and separate review.
