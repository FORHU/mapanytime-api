module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
   
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],


    'no-console': ['warn', { allow: ['error', 'info', 'warn'] }],

    
    'no-return-await': 'error',
  },
  overrides: [
    {
      
      files: ['prisma/**/*.ts', 'src/app.ts', 'src/utils/redis.util.ts'],
      rules: { 'no-console': 'off' },
    },
    {
     
      files: ['src/repositories/*.ts'],
      rules: { 'no-return-await': 'off' },
    },
  ],
};