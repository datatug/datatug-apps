/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { join } from 'path';

// Unlike libs/datatug/semantic (an Angular component library), this is a
// plain TypeScript types package with no Angular/DOM surface, so it skips
// `createBaseViteConfig` (which wires the Angular JIT plugin + happy-dom +
// Firestore/TestBed test-setup) in favour of a minimal node-environment
// config — that base config's Angular-specific pieces don't apply here.

const dirname = new URL('.', import.meta.url).pathname;
const rootPath = process.cwd();
const relativeToRoot = join(
  dirname,
  Array(dirname.replace(rootPath, '').split('/').filter(Boolean).length)
    .fill('..')
    .join('/'),
  'node_modules/.vite',
  dirname.replace(rootPath, ''),
);
const coverageDir = join(
  dirname,
  Array(dirname.replace(rootPath, '').split('/').filter(Boolean).length)
    .fill('..')
    .join('/'),
  'coverage',
  dirname.replace(rootPath, ''),
);

export default defineConfig({
  root: dirname,
  cacheDir: relativeToRoot,
  plugins: [nxViteTsPaths()],
  test: {
    name: 'datatug-board-models',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      enabled: true,
      reportsDirectory: coverageDir,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/index.ts'],
    },
  },
});
