/// <reference types='vitest' />
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import { createBaseViteConfig, type BaseViteConfigOptions } from '../../../vite.config.base';

export function createDatatugMainViteConfig(
	coverageEnabled = true,
	moduleSharing?: BaseViteConfigOptions['moduleSharing'],
): ViteUserConfig {
	const config = createBaseViteConfig({
		dirname: __dirname,
		name: moduleSharing === 'mocking-only' ? 'datatug-main:isolated' : 'datatug-main',
		reportsDirectory:
			moduleSharing === 'mocking-only'
				? '../../../coverage/libs/datatug/main-isolated'
				: undefined,
		moduleSharing,
	});
	return {
		...config,
		test: {
			...config.test,
			reporters:
				process.env['CI'] === 'true' && moduleSharing === 'shared'
					? [
							'default',
							['json', { outputFile: '../../../coverage/libs/datatug/main/vitest-results.json' }],
						]
					: config.test?.reporters,
			// The full suite can lose a VM thread before reporting results, so it runs in forks.
			pool: 'forks',
			coverage: {
				...config.test?.coverage,
				enabled: coverageEnabled,
			},
		},
	};
}

// The `test` target: every spec file except those that mock modules (`vite.isolated.config.mts`).
export default defineConfig(() => createDatatugMainViteConfig(true, 'shared'));
