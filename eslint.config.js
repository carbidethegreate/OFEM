const js = require('@eslint/js');
const eslintConfigPrettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      quotes: [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: true },
      ],
      semi: ['error', 'always'],
      indent: ['error', 2],
      'no-unused-vars': 'warn',
      'no-empty': 'off',
    },
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest, ...globals.browser },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
    },
  },
];
