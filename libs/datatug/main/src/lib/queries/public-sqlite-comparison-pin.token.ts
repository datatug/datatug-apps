import { InjectionToken } from '@angular/core';

export interface PublicSqliteCompareWasmPin {
  readonly wasmSHA256: string;
  readonly wasmBytes: number;
}

/** Supplied by the application from its tracked, release-verified artifact lock. */
export const PUBLIC_SQLITE_COMPARE_WASM_PIN = new InjectionToken<PublicSqliteCompareWasmPin>(
  'PUBLIC_SQLITE_COMPARE_WASM_PIN',
);
