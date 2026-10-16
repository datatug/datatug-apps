import { describe, expect, it, vi } from 'vitest';

const registerModules = vi.fn();
const setLicenseKey = vi.fn();
const withCharts = vi.fn((charts: unknown) => ({ enterpriseWith: charts }));

vi.mock('ag-grid-community', () => ({ ModuleRegistry: { registerModules } }));
vi.mock('ag-charts-enterprise', () => ({ AgChartsEnterpriseModule: 'charts' }));
vi.mock('ag-grid-enterprise', () => ({
  AllEnterpriseModule: { with: withCharts },
  LicenseManager: { setLicenseKey },
}));

describe('registerAgGridEnterprise', () => {
  it('registers all enterprise modules with integrated charts, then sets the key', async () => {
    const { registerAgGridEnterprise } =
      await import('./ag-grid-enterprise-loader');
    registerAgGridEnterprise('TEST-ONLY-KEY');
    expect(withCharts).toHaveBeenCalledWith('charts');
    expect(registerModules).toHaveBeenCalledWith([
      { enterpriseWith: 'charts' },
    ]);
    expect(setLicenseKey).toHaveBeenCalledWith('TEST-ONLY-KEY');
    expect(registerModules.mock.invocationCallOrder[0]).toBeLessThan(
      setLicenseKey.mock.invocationCallOrder[0],
    );
  });
});
