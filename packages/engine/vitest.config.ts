import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// I test leggono kernel e contracts dalle sorgenti: nessuna dipendenza dall'ordine di build.
export default defineConfig({
  resolve: {
    alias: {
      '@revra/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
      '@revra/kernel': fileURLToPath(new URL('../kernel/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'node' },
});
