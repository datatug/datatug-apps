import { ViteUserConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { join } from 'path';

export interface BaseViteConfigOptions {
  dirname: string;
  name: string;
  reportsDirectory?: string;
}

export function createBaseViteConfig(
  options: BaseViteConfigOptions,
): ViteUserConfig {
  const { dirname, name, reportsDirectory } = options;

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
        'zone.js',
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
      pool: 'vmThreads',
      environment: 'happy-dom',
      include: ['src/**/*.spec.ts'],
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
            '@ionic/angular/standalone',
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
