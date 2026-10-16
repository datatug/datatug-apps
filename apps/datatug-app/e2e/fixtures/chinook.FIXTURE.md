# Pinned Chinook browser fixture

`chinook.sqlite` is a byte-for-byte copy of
`demo-db/chinook/artifacts/data/chinook.sqlite` at commit
`85ad3b4d4014dd5a6ee506410beee99771801811`. The provider traces the
unchanged source to `lerocha/chinook-database` revision
`7f67772503d71ba90f19283c38e93923addb43fa`.

- Size: 1,007,616 bytes
- SHA-256: `7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15`
- Approved browser URL: `https://chinook.demodb.dev/data/chinook.sqlite`
- License: MIT; the original Chinook notice is in `chinook.LICENSE.md`.

`chinook-compare.sqlite` is the synthetic comparison fixture from the same
provider commit, with the changes documented in `chinook-compare.NOTICE.md`.
It is 1,007,616 bytes with SHA-256
`3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f`.
The comparison test serves it only at the production comparison target URL
declared by `PUBLIC_CHINOOK_COMPARISON_TARGETS`.

`../helpers/pinned-chinook-sqlite.ts` checks these bytes against the checked-in
digest and the demo project's admitted browser source before serving the exact
URL inside browser execution tests. The application still validates and runs
the file through its real SQLite worker. The separate public availability
checks continue to request the live URL.
