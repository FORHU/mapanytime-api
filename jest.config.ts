import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  // uuid v14+ ships ESM only — transform it through ts-jest
  transformIgnorePatterns: [
    "node_modules/(?!(uuid)/)",
  ],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: false }],
    "^.+\\.js$": ["ts-jest", { useESM: false }],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/server.ts",
    "!src/worker.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  verbose: true,
};

export default config;
