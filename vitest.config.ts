import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load .env file for tests
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'lib/',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vitest.config.ts',
        'vitest.setup.ts',
      ],
    },
    // Increase timeout for integration tests with OpenAI
    testTimeout: 30000,
  },
});
