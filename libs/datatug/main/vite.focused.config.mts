/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { createDatatugMainViteConfig } from './vite.config.mts';

// Focused runs are often launched concurrently; avoid racing on one coverage
// directory. The full `test` target remains the authoritative coverage gate.
// Any chosen files, module mocks included, each run isolated as on their own.
export default defineConfig(() => createDatatugMainViteConfig(false));
