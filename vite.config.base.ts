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
   * Run spec files without a fresh module graph per file (`isolate: false`): Angular, Ionic and the app's own
   * modules are evaluated once per worker instead of once per file, which is most of a TestBed spec's run time.
   * `src/test-setup.ts` must reset shared globals per file (see `resetSharedGlobals` in libs/testing). Files
   * that call `vi.mock`/`vi.doMock` still run isolated: a module mock cannot apply to a module an earlier
   * file in the same worker already loaded.
   */
  shareModulesAcrossFiles?: boolean;
}

const SPEC_FILES = ['src/**/*.spec.ts'];
const SPEC_FILE = /\.spec\.ts$/;
const MODULE_MOCK = /\bvi\.(do)?[mM]ock\(/;

/** The spec files under `src` (relative to `dirname`) that mock modules, and so need a module graph of their own. */
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
  const { dirname, name, reportsDirectory, shareModulesAcrossFiles } = options;

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
      // vmThreads gives every file a fresh VM context, so sharing modules needs forks.
      pool: shareModulesAcrossFiles ? 'forks' : 'vmThreads',
      environment: 'happy-dom',
      // With projects, each one names its own files: `extends` would append to this list, not replace it.
      include: shareModulesAcrossFiles ? [] : SPEC_FILES,
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
      ...(shareModulesAcrossFiles && {
        projects: [
          {
            extends: true,
            test: {
              name,
              isolate: false,
              include: SPEC_FILES,
              exclude: specFilesMockingModules(dirname),
            },
          },
          {
            extends: true,
            test: {
              name: `${name}:isolated`,
              include: specFilesMockingModules(dirname),
            },
          },
        ],
      }),
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
