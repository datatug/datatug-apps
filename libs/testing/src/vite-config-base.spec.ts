import { resolve } from 'node:path';
import { createBaseViteConfig } from '../../../vite.config.base';

/**
 * Guard for the shared Vitest config (datatug-apps#528). Every project built on `createBaseViteConfig` must run in
 * forks with a fresh module graph per spec file. Vitest 4 forces `isolate: false` for the vm pools (`vmThreads`,
 * `vmForks`), where a module one file loaded, with its `vi.mock` factories bound in, is handed to the next file in
 * the same worker: mocks leak and results depend on worker layout. Only `moduleSharing: 'shared'` may turn
 * isolation off, and it still needs forks. This spec fails if a later edit to vite.config.base.ts changes that.
 */
describe('createBaseViteConfig test isolation', () => {
  const dirname = resolve(__dirname, '..');
  const testConfig = (moduleSharing?: 'shared' | 'mocking-only') =>
    createBaseViteConfig({ dirname, name: 'guard', moduleSharing }).test;

  it('isolates every spec file in forks by default', () => {
    expect(testConfig()).toMatchObject({ pool: 'forks', isolate: true });
  });

  it('isolates the module-mocking run too', () => {
    expect(testConfig('mocking-only')).toMatchObject({
      pool: 'forks',
      isolate: true,
    });
  });

  it('only the explicit shared mode shares modules, and it stays in forks', () => {
    expect(testConfig('shared')).toMatchObject({
      pool: 'forks',
      isolate: false,
    });
  });
});
