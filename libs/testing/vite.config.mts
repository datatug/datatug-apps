/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { join } from 'path';

// The shared spec setup's own tests. Only its framework-free helpers are
// tested here, in happy-dom (the DOM the app's specs run in), without the
// Angular JIT plugin and TestBed setup that `createBaseViteConfig` adds.
const dirname = new URL('.', import.meta.url).pathname;
const root = join(dirname, '../..');

export default defineConfig({
  root: dirname,
  cacheDir: join(root, 'node_modules/.vite/libs/testing'),
  test: {
    name: 'testing',
    watch: false,
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      enabled: true,
      reportsDirectory: join(root, 'coverage/libs/testing'),
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/storage-spies.ts'],
    },
  },
});
