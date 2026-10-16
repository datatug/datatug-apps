import { describe, expect, it, vi } from 'vitest';

const registerModules = vi.fn();
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: 'community',
  ModuleRegistry: { registerModules },
}));

describe('registerAgGridCommunity', () => {
  it('registers AllCommunityModule', async () => {
    const { registerAgGridCommunity } =
      await import('./ag-grid-community-loader');
    registerAgGridCommunity();
    expect(registerModules).toHaveBeenCalledWith(['community']);
  });
});
