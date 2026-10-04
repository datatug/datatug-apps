/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';
import { createBaseViteConfig } from '../../../vite.config.base';

export default defineConfig(() => {
	const config = createBaseViteConfig({
		dirname: __dirname,
		name: 'datatug-main',
	});
	return {
		...config,
		test: {
			...config.test,
			// The full suite can lose a VM thread before reporting results.
			// Isolate each test file in a process while retaining the shared gates.
			pool: 'forks',
		},
	};
});
