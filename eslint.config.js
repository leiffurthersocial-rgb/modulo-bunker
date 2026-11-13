import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', '.asset-cache'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // sim/ and gen/ must stay pure: no Three.js, no DOM.
    files: ['src/sim/**/*.ts', 'src/gen/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*', '../render/*', '../ui/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'performance'],
    },
  },
);
