/// <reference types='vitest' />
import { defineConfig, mergeConfig } from 'vitest/config';
import { createBaseViteConfig } from '../../vite.config.base';

export default defineConfig(() =>
  mergeConfig(
    createBaseViteConfig({
      dirname: __dirname,
      name: 'datatug-app',
    }),
    {
      test: {
        // Vitest 4 forces `isolate: false` for the vm pools, and its evaluated-module cache then outlives the
        // per-file VM context: a module loaded for one spec file (with that file's `vi.mock` factories bound
        // into it) is handed to every later file in the same worker, so results depend on which files share a
        // worker (`--maxWorkers=1` shows it). Forks with `isolate: true` give every file a fresh module graph.
        pool: 'forks',
        isolate: true,
      },
    },
  ),
);
