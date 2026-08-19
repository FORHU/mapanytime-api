import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // uuid v14+ ships ESM only — transform it through ts-jest
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: false }],
    '^.+\\.js$': ['ts-jest', { useESM: false }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/server.ts', '!src/worker.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true,
  /**
   * Jest defaults to cores-1 workers (11 here). Each one runs ts-jest over the
   * whole app import graph, which includes the multi-megabyte generated Prisma
   * client, and the resulting thrash has pushed integration suites from ~7s in
   * isolation to several minutes. Half the cores keeps the parallelism without
   * the contention. Type-checking stays on: tsconfig excludes tests/, so
   * ts-jest is the only thing checking test files.
   */
  maxWorkers: '50%',
};

export default config;
