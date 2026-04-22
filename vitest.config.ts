import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'tests/reports/coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts', 'src/mocks/**'],
      thresholds: {
        statements: 55,
        branches: 55,
        functions: 50,
        lines: 55,
      },
    },
    reporters: ['default'],
  },
});
