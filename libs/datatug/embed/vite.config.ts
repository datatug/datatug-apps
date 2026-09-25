import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  plugins: [{
    name: 'embed-package-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'package.json',
        source: JSON.stringify({
          name: '@datatug/embed', version: '0.1.0', type: 'module',
          description: 'Framework-neutral DataTug Grid and Chart web components',
          module: './datatug.js', exports: { '.': './datatug.js' },
          files: ['datatug.js'], sideEffects: true,
        }, null, 2) + '\n',
      });
    },
  }],
  build: {
    outDir: '../../../dist/libs/datatug/embed',
    emptyOutDir: true,
    sourcemap: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'datatug.js' },
  },
  test: { environment: 'happy-dom', include: ['src/**/*.spec.ts'] },
});
