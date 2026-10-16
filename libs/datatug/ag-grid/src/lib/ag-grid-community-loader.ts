// Imported only through the dynamic `import()` in ag-grid-setup.ts, so the startup path (which calls
// configureAgGrid) contains no AG Grid code at all.
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

export function registerAgGridCommunity(): void {
  ModuleRegistry.registerModules([AllCommunityModule]);
}
