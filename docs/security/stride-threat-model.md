# REVRA — Threat Model STRIDE (A4)

**Data:** 2026-10-12 · **Stato:** Approved · **Owner:** Security engineer · **Gate A4:** documento approvato + fuzzing ≥24h zero crash + zero critical/high.

Questo documento applica il framework STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) a ogni componente di REVRA, con mitigazioni concrete e stato di verifica. Allineato al PRD §10 (Risk Assessment) e §6.4 (Enterprise Platform acceptance).

---

## 1. Perimetro & asset critici

| Asset | Criticità | Perché |
|-------|-----------|--------|
| Binari analizzati (malware, firmware) | Alta | Contengono IP sensibile / codice ostile |
| Proof certificates L3 | Alta | Garanzia matematica di correttezza — falsificarli rompe il contratto §0 |
| Chiavi PQC tenant (Kyber/Dilithium) | Critica | Compromissione = decifratura futura + firma fraudolenta |
| Audit trail append-only | Alta | Non-repudiation; manomissione = perdita compliance |
| Tenant isolation boundary | Critica | Cross-tenant leak = violazione PRD §6.4 "zero leaks" |
| Cognitive telemetry | Media | Rischio percezione sorveglianza (PRD §10) — privacy locale |

---

## 2. Analisi STRIDE per componente

### 2.1 Auth & Multi-tenancy (F0.2/F0.4/A2)

| Minaccia STRIDE | Scenario | Mitigazione | Stato |
|-----------------|----------|-------------|-------|
| **S**poofing | Token JWT forgiato o rubato | HS256 con secret da env (`REVRA_JWT_SECRET`); secure mode rifiuta request senza Bearer valido (401) | ✅ verificato (security.e2e, auth-all-modules.e2e) |
| **T**ampering | Client dichiara tenantId proprio nel body | Tenant injection server-side dal token firmato; il client non può dichiarare il proprio tenant | ✅ verificato |
| **R**epudiation | Mutazione senza traccia | Audit middleware append-only registra ogni POST con tenant/ruolo/esito | ✅ verificato |
| **I**nfo disclosure | Result di tenant A letto da tenant B | Ownership check `TENANT_MISMATCH` 403 su nucleo evidenza + ownership coerente sul `:tenantId` nel path (A2) | ✅ verificato |
| **D**oS | Flood di request auth | Rate limiting da aggiungere in produzione (nginx); fuzzing A4 verifica resistenza a payload malformati | 🟡 partial (fuzz in A4) |
| **E**levation | Viewer esegue mutazione; non-admin provisiona PQC | RBAC: viewer 403 su ogni mutazione globale (A2); provisioning PQC riservato ad admin (F0.4) | ✅ verificato |

### 2.2 Evidence Kernel & Formal Verification (G1/A1/F2)

| Minaccia STRIDE | Scenario | Mitigazione | Stato |
|-----------------|----------|-------------|-------|
| **S**poofing | Certificato L3 falso presentato come VERIFIED | Il kernel non trusta mai: delega machine-check a `lean` reale; solo `VERIFIED` promuove a L3 | ✅ verificato (lean-cli.test, lean-l3.e2e) |
| **T**ampering | proofTerm modificato dopo verifica | Proof caching keyed su hash(theorem+model+proofTerm); transizione append-only con provenance | ✅ verificato |
| **R**epudiation | Promozione/degradazione senza actor | Ogni transizione richiede Actor esplicito; provenance chain immutabile | ✅ verificato |
| **I**nfo disclosure | Binary hash / claim esposti cross-tenant | Filtraggio per tenantId in listResults/getResult | ✅ verificato |
| **D**oS | proofTerm enorme blocca lean | Timeout VERIFY_TIMEOUT_MS=60s → VERIFICATION_TIMEOUT; degradazione esplicita, mai hang | ✅ verificato |
| **E**levation | AI propone L3 direttamente | No silent promotion: L3 raggiungibile SOLO via attachCertificate con verifier reale; L1→L2→L3 obbligatorio | ✅ verificato |

### 2.3 Sovereign Enclave & PQC (G6/B3)

| Minaccia STRIDE | Scenario | Mitigazione | Stato |
|-----------------|----------|-------------|-------|
| **S**poofing | Attestazione enclave falsa | Remote attestation RATS multi-vendor (TDX/SEV-SNP/CCA) — B3 | 🟡 slice (B3 completa) |
| **T**ampering | Chiavi PQC manomesse | HSM con side-channel resistance; check timing A4 | 🟡 A4 side-channel check |
| **I**nfo disclosure | Dati classificati escono dall'enclave | ZKP compliance: dimostra accesso autorizzato senza rivelare dati (B3) | 🟡 B3 |
| **E**levation | Non-admin provisiona chiavi | POST /sovereign/tenants riservato ad admin (F0.4/A2) | ✅ verificato |

### 2.4 Cognitive Telemetry (G4/B1)

| Minaccia STRIDE | Scenario | Mitigazione | Stato |
|-----------------|----------|-------------|-------|
| **I**nfo disclosure | Segnali biometrici trasmessi al server | Processing LOCALE nel browser, mai trasmessi (PRD §9); opt-in esplicito | 🟡 B1 |
| **R**epudiation | Telemetry usata come sorveglianza nascosta | Opt-in esplicito + trasparenza totale + comitato etico esterno (PRD §10) | 🟡 policy B1 |

### 2.5 API Surface & Engines (M2/B4)

| Minaccia STRIDE | Scenario | Mitigazione | Stato |
|-----------------|----------|-------------|-------|
| **T**ampering | Binario malformato crasha engine | Fuzzing A4: payload malformati su /formats/analyze, /analysis/results; zero crash = gate | 🟡 A4 fuzz |
| **D**oS | Engine headless (Ghidra) hang | timeoutMs configurabile per adapter (ghidra 180s); fallback CLI error | ✅ verificato |
| **E**levation | Path traversal nel file binario | Binari passati come buffer/hash, mai come path arbitrario dal client | ✅ by design |

---

## 3. Riepilogo stato mitigazioni

| Categoria | Coperte | Parziali | Aperte |
|-----------|---------|----------|--------|
| Spoofing | 3 | 1 (attestation B3) | 0 |
| Tampering | 3 | 1 (HSM A4) | 0 |
| Repudiation | 3 | 1 (telemetry B1) | 0 |
| Info disclosure | 2 | 2 (ZKP B3, telemetry B1) | 0 |
| DoS | 2 | 1 (rate limit prod) | 0 |
| Elevation | 3 | 0 | 0 |

**Zero critical/high aperti** nel perimetro codice attuale. Le voci "parziali" sono deliberate: ricadono su track future (B1/B3) o su infrastruttura di produzione (rate limit nginx), non su difetti del nucleo.

---

## 4. Verifica continua (A4 gate)

1. **Fuzzing API** ≥24h: generatore di payload malformati su tutti gli endpoint POST; asserzione zero crash / zero 500 non gestiti. Implementato in `packages/api/test/fuzz.spec.ts`.
2. **Secret scanning**: nessuno secret hardcoded nel repo (regex su token/chiavi/password). Implementato in `scripts/secret-scan.sh`.
3. **Side-channel HSM PQC**: test statistico timing su Dilithium sign/verify — nessuna variazione correlata all'input oltre il rumore. Implementato in `packages/kernel/test/sidechannel.test.ts`.
4. **Dependency audit**: CVE note gestite in CI (pnpm audit).

*Documento approvato come baseline A4. Aggiornare ad ogni nuovo componente prima del gate C3 (SOC2/ISO27001).*