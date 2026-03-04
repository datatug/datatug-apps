const { FlatCompat } = require('@eslint/eslintrc');
const nxEslintPlugin = require('@nx/eslint-plugin');
const js = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

module.exports = [
  {
    plugins: {
      '@nx': nxEslintPlugin,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  ...compat.config({ extends: ['plugin:@nx/typescript'] }).map((config) =>
    Object.assign(config, {
      files: [`**/*.ts`, `**/*.tsx`, `**/*.cts`, `**/*.mts`],
      rules: { ...config.rules },
    }),
  ),
  ...compat.config({ extends: ['plugin:@nx/javascript'] }).map((config) =>
    Object.assign(config, {
      files: [`**/*.js`, `**/*.jsx`, `**/*.cjs`, `**/*.mjs`],
      rules: { ...config.rules },
    }),
  ),
  {
    ignores: ['node_modules', '**/dist', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/eslint.config.*', '**/.eslintrc.*', '**/test-setup.ts'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
