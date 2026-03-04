const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

function sneatLibConfig(_dir) {
  return [];
}

function compatConfig(baseDirectory) {
  return new FlatCompat({
    baseDirectory,
    recommendedConfig: js.configs.recommended,
  });
}

module.exports = { sneatLibConfig, compatConfig };
