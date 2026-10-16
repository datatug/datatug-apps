/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { createDatatugMainViteConfig } from './vite.config.mts';

// Focused runs are often launched concurrently; avoid racing on one coverage
// directory. The full `test` target remains the authoritative coverage gate.
export default defineConfig(() => createDatatugMainViteConfig(false));
