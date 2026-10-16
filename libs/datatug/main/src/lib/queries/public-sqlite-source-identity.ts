/** Must match the fixture verified by PublicSqliteQueryService before execution. */
export const PUBLIC_CHINOOK_FIXTURE_SHA256 =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';

/** Shipped mirror of the same upstream snapshot; no query endpoint is required. */
export const PUBLIC_CHINOOK_BUNDLED_FIXTURE = Object.freeze({
  url: '/assets/showcase/chinook.sqlite',
  sha256: PUBLIC_CHINOOK_FIXTURE_SHA256,
  bytes: 1007616,
});
export const PUBLIC_CHINOOK_LEGACY_FIXTURE_URL =
  'https://chinook.demodb.dev/data/chinook.sqlite';

/** Separate synthetic comparison revision; never substitute it for the baseline. */
export const PUBLIC_CHINOOK_BUNDLED_CANDIDATE = Object.freeze({
  url: '/assets/showcase/chinook-candidate-3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
  sha256: '3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f',
  bytes: 1007616,
});
