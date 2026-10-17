import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@revra/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
      '@revra/kernel': fileURLToPath(new URL('../kernel/src/index.ts', import.meta.url)),
      '@revra/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
    },
    // Una sola istanza dei moduli workspace nel grafo: evita classi duplicate
    // tra alias (sorgente) e risoluzione node_modules (symlink).
    dedupe: ['@revra/contracts', '@revra/kernel'],
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    // Processa i pacchetti workspace dentro il grafo vite (niente require
    // nativo): una sola istanza di ogni modulo, instanceof affidabile.
    server: { deps: { inline: [/@revra\//] } },
  },
});
