import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'tests/reports/coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',
        'src/cli/**',
        'src/**/*.d.ts',
        'src/mocks/**',
        'src/prompts/**',
      ],
      thresholds: {
        statements: 85,
        branches: 60,
        functions: 85,
        lines: 85,
      },
    },
    reporters: ['default'],
  },
});
