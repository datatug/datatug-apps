// The ONLY file that imports `ag-grid-enterprise` / `ag-charts-enterprise`. It is reached solely through
// the dynamic `import()` in ag-grid-setup.ts, so the bundler emits it (and both enterprise packages) as a
// lazy chunk that the browser never downloads unless a license key is configured.
//
// Facts: https://www.ag-grid.com/angular-data-grid/modules/ (AllEnterpriseModule.with(AgChartsEnterpriseModule)
// for Integrated Charts) and https://www.ag-grid.com/angular-data-grid/license-install/ (register the
// modules, then LicenseManager.setLicenseKey).
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';
import { ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';

export function registerAgGridEnterprise(licenseKey: string): void {
  ModuleRegistry.registerModules([
    AllEnterpriseModule.with(AgChartsEnterpriseModule),
  ]);
  LicenseManager.setLicenseKey(licenseKey);
}
