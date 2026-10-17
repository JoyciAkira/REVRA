import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@revra/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
      // Solo la policy cognitiva nel bundle browser: il barrel di engine
      // trascinerebbe node:crypto (consensus) nel client.
      '@revra/engine/adaptive-policy': fileURLToPath(
        new URL('../engine/src/cognitive/adaptive-policy.ts', import.meta.url),
      ),
    },
  },
  // Il dev server proxya l'API: nessun CORS da gestire in G1.
  server: {
    proxy: { '/analysis': 'http://localhost:3000', '/hybrid': 'http://localhost:3000', '/consensus': 'http://localhost:3000', '/cognitive': 'http://localhost:3000' },
  },
});
