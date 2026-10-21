# Pinned Chinook browser fixture

`../../src/assets/showcase/chinook.sqlite` is a byte-for-byte copy of
`demo-db/chinook/artifacts/data/chinook.sqlite` at commit
`85ad3b4d4014dd5a6ee506410beee99771801811`. The provider traces the
unchanged source to `lerocha/chinook-database` revision
`7f67772503d71ba90f19283c38e93923addb43fa`.

- Size: 1,007,616 bytes
- SHA-256: `7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15`
- Approved browser source: `/assets/showcase/chinook.sqlite`, with its
  `/assets/showcase/chinook-source-rights.json` admission sidecar.
- License: MIT; the original Chinook notice is in
  `../../src/assets/showcase/chinook-LICENSE.md`.

`../../src/assets/showcase/chinook-candidate-3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite`
is the synthetic comparison fixture from the same
provider commit, with the changes documented in `chinook-compare.NOTICE.md`.
It is 1,007,616 bytes with SHA-256
`3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f`.
The comparison test serves it only at the production comparison target URL
declared by `PUBLIC_CHINOOK_COMPARISON_TARGETS`.

`../helpers/pinned-chinook-sqlite.ts` checks the shipped bytes and rights
sidecar against the demo project's admitted browser source. Browser tests load
the relative application asset from the actual built app through its real
SQLite worker. Comparison tests serve the same hash-checked shipped bytes only
for their separately declared public baseline and candidate URLs. Separate
public availability checks continue to request the live URL.
