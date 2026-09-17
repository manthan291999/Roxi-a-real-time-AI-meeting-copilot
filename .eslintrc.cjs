module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-constant-condition': 'error',
    'no-async-promise-executor': 'error',
    'require-await': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: [
    'node_modules/',
    'src-tauri/',
    'dist/',
    '*.test.js',
  ],
  overrides: [
    {
      // The chatbot's zero-LLM pre-router (see chatbot/src/application/
      // guardrail/*.js and the pre-router plan §07/§08's Dependency
      // Inversion section): nothing in this folder may reach an LLM SDK, a
      // database driver, or a concrete node implementation. Enforced here
      // rather than left as a comment, so the boundary is structural — a
      // lint error, not a promise a future edit can quietly break.
      //
      // NOTE: this codebase is CommonJS (`require`, not ES `import`), so
      // the applicable rule is `no-restricted-modules`, NOT
      // `no-restricted-imports` — the latter is a no-op on `require()`
      // calls (verified: it does not fire on a single `require()` in this
      // config while `no-restricted-modules` does, against the same file).
      files: ['chatbot/src/application/guardrail/**'],
      rules: {
        'no-restricted-modules': ['error', {
          patterns: ['**/infrastructure/**', '**/nodes/**', 'openai', 'better-sqlite3'],
        }],
      },
    },
  ],
};
