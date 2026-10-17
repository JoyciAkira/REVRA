# ADR-0001 — Stack, piano dei 6 G e kernel-first

**Stato:** Accettata · **Data:** 2026-10-11 · **Contesto:** PRD v2.0 Beyond Limits approvato, repo greenfield.

## Decisione

1. **Monorepo TypeScript** (pnpm workspaces): `contracts` (zod) → `kernel` (policy
   affidabilità, zero I/O) → `api` (NestJS REST) → `web` (React+Vite+Tailwind).
   Bridge verso Lean4/Coq via adapter CLI; motori RE (Ghidra, radare2, …)
   entreranno come container nel G2.
2. **Sei goal di upgrade** (titoli §3.1–3.4 del PRD) conseguiti uno per volta in
   vertical slice: dominio → servizio → API → test accettazione → UI minima.
   Ordine G1→G6: il kernel di evidenza (§0) è fondazione trasversale di tutti
   gli altri.
3. **La policy di affidabilità vive SOLO nel kernel** (classi pure, eventi
   append-only, nessun I/O): API e UI sono facade. Ogni violazione è un
   `KernelRuleError` con codice = contratto PRD §0.2; l'API lo traduce in 409/404
   espliciti, mai 200 silenziosi.

## Conseguenze

- Velocità di entrega e tipizzazione end-to-end; i target di latenza estremi
  (<1ms consensus) potranno richiedere un core Rust innestato dietro il kernel
  (ADR futura, il seam `EvidenceKernel` resta stabile).
- `Lean4CliVerifier` è l'unico punto che conosce la toolchain di proof: assente
  → degradazione esplicita `VERIFIER_UNAVAILABLE` (contratto §0.2), mai crash.
- Le metriche doppie (§0.3) sono calcolate dal kernel e shipgate di ogni G.

## Errori evitati in futuro

- tsc con `paths` verso sorgenti di altri package + `rootDir` emette artifact
  `.js` dentro `src/` altrimenti: vietato (`.gitignore` li blocca). I typecheck
  cross-package passano dai `dist` (script root: build → typecheck).
- I `package.json` dei package libri espongono `dist` (mai `src`): Node nativo
  non risolve il mapping `.js→.ts` di TypeScript.
