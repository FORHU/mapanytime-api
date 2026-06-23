module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // 🔥 Core safety rules
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // 🔥 Clean backend rules
    'no-console': ['warn', { allow: ['error', 'info', 'warn'] }],

    // optional but recommended for your architecture
    'no-return-await': 'error',
  },
  overrides: [
    {
      // Allow console logs in seeders and infrastructure setup
      files: ['prisma/**/*.ts', 'src/app.ts', 'src/utils/redis.util.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      // Specifically allow 'return await' in repository files 
      // if you decide keeping them is more readable for database transactions
      files: ['src/repositories/*.ts'],
      rules: { 'no-return-await': 'off' },
    },
  ],
};