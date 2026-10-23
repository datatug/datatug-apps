/**
 * Order-independence guard (datatug-apps#528). Every spec file must get a fresh module graph. Vitest 4 forces
 * `isolate: false` for the vm pools (`vmThreads`, `vmForks`), and there a module a spec file loaded, with that
 * file's `vi.mock` factories bound into it, is handed to the next file in the same worker. Results then depend on
 * how files are spread over workers, and `--maxWorkers=1` fails. `vite.config.mts` therefore runs `forks` with
 * `isolate: true`; this spec fails if that changes. Full proof, about 40 s:
 * `pnpm exec vitest run --config apps/datatug-app/vite.config.mts --maxWorkers=1 --sequence.shuffle.files --sequence.shuffle.tests`.
 */
it('runs every spec file with a fresh module graph', () => {
  const config = (
    globalThis as unknown as {
      __vitest_worker__?: { config: { isolate: boolean; pool: string } };
    }
  ).__vitest_worker__?.config;
  expect(config).toMatchObject({ isolate: true, pool: 'forks' });
});
