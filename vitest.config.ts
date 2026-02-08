import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/__tests__/**/*.test.ts',
      'apps/*/src/**/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@vena/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@vena/providers': path.resolve(__dirname, 'packages/providers/src/index.ts'),
      '@vena/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@vena/semantic-memory': path.resolve(__dirname, 'packages/semantic-memory/src/index.ts'),
      '@vena/channels': path.resolve(__dirname, 'packages/channels/src/index.ts'),
      '@vena/gateway': path.resolve(__dirname, 'packages/gateway/src/index.ts'),
      '@vena/skills': path.resolve(__dirname, 'packages/skills/src/index.ts'),
      '@vena/computer': path.resolve(__dirname, 'packages/computer/src/index.ts'),
      '@vena/voice': path.resolve(__dirname, 'packages/voice/src/index.ts'),
      '@vena/integrations': path.resolve(__dirname, 'packages/integrations/src/index.ts'),
      '@vena/agents': path.resolve(__dirname, 'packages/agents/src/index.ts'),
    },
  },
});
