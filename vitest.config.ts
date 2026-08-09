import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
})
