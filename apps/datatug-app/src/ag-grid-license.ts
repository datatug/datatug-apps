// AG Grid Enterprise license key, injected at build time. The committed value MUST stay empty: with no key
// the app registers AG Grid Community only and never downloads the enterprise chunk.
//
// `stamp-ag-grid-license` (tools/stamp-ag-grid-license.mjs) writes a gitignored `ag-grid-license.generated.ts`
// from the AG_GRID_LICENSE_KEY environment variable (or .env.local), and Angular `fileReplacements`
// swaps it in — the same pattern as build-info.ts. See docs/ag-grid-enterprise-license.md.
// An AG Grid key is shipped to browsers by design, so this is public configuration, never a secret store.
export const AG_GRID_LICENSE_KEY = '';
