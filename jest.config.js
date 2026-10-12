/** @type {import('jest').Config} */
const base = {
  testEnvironment: "node",
  transform: { "^.+\\.[tj]sx?$": "babel-jest" },
  setupFiles: ["<rootDir>/tests/setup/env.ts"],
  clearMocks: true,
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: "unit",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      setupFiles: ["<rootDir>/tests/setup/env.ts"],
    },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      setupFiles: [
        "<rootDir>/tests/setup/env.ts",
        "<rootDir>/tests/setup/integration-env.ts",
      ],
      setupFilesAfterEnv: ["<rootDir>/tests/setup/integration.ts"],
      testTimeout: 20000,
    },
  ],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/app/server.ts",
    "!src/models/**",
  ],
  coverageReporters: ["text-summary", "lcov"],
  coverageThreshold: {
    global: { statements: 95, branches: 90, functions: 95, lines: 95 },
  },
};
