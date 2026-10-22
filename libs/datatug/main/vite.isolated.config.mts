/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { createDatatugMainViteConfig } from './vite.config.mts';

// The `test-isolated` target: the spec files that mock modules, each in a module graph of its own.
export default defineConfig(() => createDatatugMainViteConfig(true, 'mocking-only'));
