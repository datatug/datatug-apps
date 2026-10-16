/// <reference types='vitest' />
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import { createBaseViteConfig } from '../../../vite.config.base';

export function createDatatugMainViteConfig(coverageEnabled = true): ViteUserConfig {
	const config = createBaseViteConfig({
		dirname: __dirname,
		name: 'datatug-main',
	});
	return {
		...config,
		test: {
			...config.test,
			reporters:
				process.env['CI'] === 'true'
					? [
							'default',
							['json', { outputFile: '../../../coverage/libs/datatug/main/vitest-results.json' }],
						]
					: config.test?.reporters,
			// The full suite can lose a VM thread before reporting results.
			// Isolate each test file in a process while retaining the shared gates.
			pool: 'forks',
			coverage: {
				...config.test?.coverage,
				enabled: coverageEnabled,
			},
		},
	};
}

export default defineConfig(() => createDatatugMainViteConfig());
