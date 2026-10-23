/// <reference types='vitest' />
import { defineConfig, mergeConfig } from 'vitest/config';
import { createBaseViteConfig } from '../../../vite.config.base';

export default defineConfig(() =>
	mergeConfig(
		createBaseViteConfig({
			dirname: __dirname,
			name: 'datatug-charts',
		}),
		{
			test: {
				// Vitest 4 forces `isolate: false` for the vm pools, so module mocks leak between spec files and
				// results depend on run order. Forks with `isolate: true` give every file a fresh module graph
				// (same as apps/datatug-app).
				pool: 'forks',
				isolate: true,
			},
		},
	),
);
