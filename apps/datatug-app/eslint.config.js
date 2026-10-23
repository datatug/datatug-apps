const baseConfig = require('../../eslint.config.js');

const { sneatLibConfig } = require('../../eslint.lib.config.js');

module.exports = [
  ...baseConfig,
  ...sneatLibConfig(__dirname),
  // Populated from the lock-verified Core release by the app's build target.
  // These third-party generated sources are validated by the artifact consumer, not authored here.
  // Relative to this file: Nx 24 runs `eslint .` from the project directory.
  {
    ignores: ['src/assets/recordsetcompare/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/prefer-standalone': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ionic/angular',
              message: 'Use focused Ionic entry points such as @ionic/angular/standalone or @ionic/angular/provide.',
            },
          ],
        },
      ],
    },
  },
];
