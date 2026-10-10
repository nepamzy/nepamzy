import { defineConfig } from 'vitest/config'
import path from 'node:path'

const alias = { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
})
