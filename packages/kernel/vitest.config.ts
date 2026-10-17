import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests import contracts from source so the suite never depends on build order.
export default defineConfig({
  resolve: {
    alias: {
      '@revra/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'node' },
});
