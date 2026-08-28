const baseConfig = require('../../eslint.config.js');

const { sneatLibConfig } = require('../../eslint.lib.config.js');

module.exports = [
  ...baseConfig,
  ...sneatLibConfig(__dirname),
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
