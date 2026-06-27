// ESLint 9 flat config. ESLint 9 dropped .eslintrc + the `--ext` flag in favor
// of this file, which is why `npm run lint` previously crashed. Kept lenient on
// purpose: it catches real problems (undefined vars, obvious mistakes) without
// reformatting or nitpicking the existing hand-written code. Prettier (advisory,
// see .prettierrc.json) owns formatting.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default tseslint.config(
  {
    // Generated, vendored, or non-source paths ESLint should never read.
    ignores: [
      'dist/**',
      '.cache/**',
      'node_modules/**',
      'public/birding/wasm/**',
      'src/content/sessions/**',
      'src/env.d.ts',
      '.astro/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The codebase intentionally uses some `any`, non-null assertions, CommonJS
      // requires (Azure Functions), inline `var`, and a `@ts-ignore`. These are
      // pre-existing and deliberate; lint catches real bugs, not these patterns.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-var': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // TypeScript itself reports undefined identifiers; the ESLint rule only
      // produces false positives on typed/ambient code.
      'no-undef': 'off',
    },
  },
  {
    // Test files use Vitest globals (vitest.config sets globals: true).
    files: ['**/*.test.{ts,js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  {
    // Node-side scripts and Azure Functions run in CommonJS/Node land.
    files: ['scripts/**/*.{js,mjs}', 'api/**/*.{js,cjs}', '*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
