import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/performance/**/*.test.ts'],
    reporters: ['verbose'],
  },
})
