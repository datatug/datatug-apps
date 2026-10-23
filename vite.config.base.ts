import { ViteUserConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

export interface BaseViteConfigOptions {
  dirname: string;
  name: string;
  reportsDirectory?: string;
  /**
   * `shared`: run spec files without a fresh module graph per file (`isolate: false`), so Angular, Ionic and
   * the app's own modules are evaluated once per worker instead of once per file, which is most of a TestBed
   * spec's run time. `src/test-setup.ts` must reset shared globals per file (see `resetSharedGlobals` in
   * libs/testing). Files that call `vi.mock`/`vi.doMock`/`vi.doUnmock`/`vi.resetModules` are left out: a module
   * mock cannot apply to a module an earlier file in the same worker already loaded, and a reset reloads Angular
   * itself for every later file (no test environment). `mocking-only` runs just those files, isolated.
   * They are two runs, not two Vitest projects: each project starts its own Vite server and Angular compiler,
   * which doubles the main process's memory past Node's default heap.
   */
  moduleSharing?: 'shared' | 'mocking-only';
}

const SPEC_FILES = ['src/**/*.spec.ts'];
const SPEC_FILE = /\.spec\.ts$/;
// A module mock, or a reset of the module registry: either changes the module graph that later files would share.
const MODULE_MOCK = /\bvi\.((do)?[mM]ock|doUnmock|resetModules)\(/;

/** The spec files under `src` (relative to `dirname`) that mock or reset modules, and so need a module graph of their own. */
export function specFilesMockingModules(dirname: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SPEC_FILE.test(entry.name) && MODULE_MOCK.test(readFileSync(path, 'utf8')))
        files.push(relative(dirname, path));
    }
  };
  walk(join(dirname, 'src'));
  return files.sort();
}

export function createBaseViteConfig(
  options: BaseViteConfigOptions,
): ViteUserConfig {
  const { dirname, name, reportsDirectory, moduleSharing } = options;

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

  return {
    root: dirname,
    cacheDir: relativeToRoot,
    resolve: {
      dedupe: [
        '@angular/core',
        '@angular/common',
        '@angular/common/http',
        '@angular/platform-browser',
        '@angular/platform-browser-dynamic',
        '@angular/router',
        '@angular/fire',
        'rxjs',
      ],
    },
    plugins: [
      angular({
        jit: true,
        tsconfig: './tsconfig.spec.json',
      }),
      nxViteTsPaths(),
    ],
    test: {
      name,
      watch: false,
      globals: true,
      // Every project runs in forks with a fresh module graph per spec file. Vitest 4 forces `isolate: false` for the
      // vm pools (`vmThreads`, `vmForks`), and there a module one file loaded, with that file's `vi.mock` factories
      // bound into it, is handed to the next file in the same worker: mocks leak and results depend on how files
      // spread over workers. Only `moduleSharing: 'shared'` opts out, on purpose. libs/testing's
      // vite-config-base.spec.ts and apps/datatug-app's test-isolation.spec.ts guard this.
      pool: 'forks',
      isolate: moduleSharing !== 'shared',
      environment: 'happy-dom',
      include:
        moduleSharing === 'mocking-only'
          ? specFilesMockingModules(dirname)
          : SPEC_FILES,
      ...(moduleSharing === 'shared' && {
        exclude: specFilesMockingModules(dirname),
      }),
      setupFiles: [join(dirname, 'src/test-setup.ts')],
      reporters: ['default'],
      printConsoleTrace: false,
      coverage: {
        enabled: true,
        reportsDirectory: reportsDirectory || coverageDir,
        provider: 'v8' as const,
        reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
        all: true,
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.spec.ts',
          'src/**/test-setup.ts',
          'src/**/*.stories.ts',
          'src/**/index.ts',
        ],
      },
      server: {
        deps: {
          inline: [
            '@ionic/angular',
            '@ionic/angular',
            '@angular/fire',
            /@angular\//,
            /@sneat\//,
            /@stencil\//,
            /tslib/,
          ],
        },
      },
    },
  } as ViteUserConfig;
}
