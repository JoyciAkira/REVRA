# REVRA — Enterprise Reverse Engineering Platform Specification

**Interview ID:** revra-2026-10-10
**Ambiguity Score:** 18% (threshold: 20%, source: default)
**Status:** PASSED
**Project Type:** Greenfield

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 40% | 0.36 |
| Constraint Clarity | 0.85 | 30% | 0.255 |
| Success Criteria | 0.85 | 30% | 0.255 |
| Context Clarity | N/A | N/A | N/A |
| **Total Clarity** | | | **0.87** |
| **Ambiguity** | | | **0.13 (13%)** |

## Topology

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| Unified RE Engine | Active | Core che incorpora nativamente rea.tools, Ghidra e OSS RE projects come componenti interni via containerized microservices con sandboxing isolato | Cross-engine shared state + unified API surface + performance parity/better |
| Analysis Workspace | Active | Unified multi-tool workspace con real-time sync, zero-copy shared memory, web-native GPU acceleration e deterministic replay | Real-time <50ms sync, WebGL/WebGPU rendering, full session auditability |
| Knowledge Base | Active | Full RE Corpus: artifact tecnici, collaborazione, dataset pubblici (malware DB, CVE, exploit DB), training data AI, benchmark, knowledge graph | Persistent native knowledge base covering entire RE domain |
| Enterprise Platform | Active | Multi-team collaborative RE platform + scalable analysis infrastructure + compliance-first secure enclave combinati al massimo livello | RBAC, audit trail forense, air-gap, SOC2/ISO27001, resource pooling, SLA |

## Goal

REVRA è la piattaforma enterprise definitiva per la retroingegneria: un unico ambiente unificato che incorpora nativamente i migliori motori RE open-source (rea.tools, Ghidra e altri) come componenti interni, offrendo un'esperienza di analisi collaborativa in tempo reale con conoscenza persistente e infrastruttura enterprise di livello massimo.

## Constraints

- **Architettura:** Containerized microservices con sandboxing isolato e orchestrazione dinamica per runtime eterogenei (Java/C/C++/Python/Rust/WASM)
- **Workspace:** Real-time sync <50ms tra tutti i motori, zero-copy shared memory, rendering web-native con accelerazione GPU (WebGL/WebGPU), deterministic replay con branching
- **Knowledge Base:** Full RE Corpus persistente e nativo — non limitato agli artifact di progetto
- **Enterprise:** Multi-tenancy con isolamento team/progetti, RBAC granulare, audit trail forense completo, supporto air-gap, crittografia end-to-end degli artifact, data residency configurabile, certificazioni SOC2/ISO27001
- **Performance:** Parity or better rispetto ai tool standalone; nessun overhead percepibile dall'orchestrazione
- **API:** Unified API surface trasparente — l'analista non deve mai sapere quale motore sta eseguendo un'operazione

## Non-Goals

- Wrapper o integrazione esterna con tool separati (REVRA incorpora, non integra)
- UI native dei tool embedded (tutto passa attraverso l'interfaccia unificata di REVRA)
- Supporto per tool proprietari closed-source non integrabili come componenti interni
- Deployment single-user desktop-only (REVRA è enterprise-first, multi-tenant)

## Acceptance Criteria

- [ ] Un'analisi avviata in Ghidra aggiorna automaticamente simboli, commenti e annotazioni in rea.tools e viceversa in <50ms
- [ ] Tutti i motori RE espongono un'unica API coerente; nessuna operazione richiede all'utente di specificare il backend
- [ ] Le performance di disassembly/decompilazione su binari di riferimento eguagliano o superano i tool standalone
- [ ] Il workspace è interamente browser-based con rendering GPU-accelerato; nessun plugin desktop richiesto
- [ ] Ogni sessione di analisi è riproducibile deterministicamente con timeline riavvolgibile e branching
- [ ] La Knowledge Base include nativamente dataset pubblici (malware DB, CVE, exploit DB) oltre agli artifact di progetto
- [ ] Multi-tenancy con isolamento completo tra team/progetti verificato tramite test di cross-tenant access denial
- [ ] Audit trail forense registra ogni azione di analisi con timestamp, utente, contesto e risultato
- [ ] Supporto air-gap verificato: funzionamento completo senza connettività internet esterna
- [ ] Crittografia end-to-end degli artifact verificata: dati illeggibili anche per gli amministratori della piattaforma senza chiave tenant

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| REVRA integra tool esterni come wrapper | User correction R1.5 | REVRA incorpora i tool come componenti interni nativi, non si integra con essi |
| "Migliore al mondo" è vago | Round 2 targeting constraints | Tradotto in architettura best-in-class: containerized microservices con sandboxing isolato |
| Enterprise = solo feature tecniche | Round 5 | Enterprise = collaborazione multi-team + scalabilità industriale + compliance secure enclave simultaneamente |
| Unificazione = launcher multiplo | Round 6 | Unificazione = cross-engine shared state + unified API + performance parity simultaneamente |
| Workspace = UI tradizionale | Round 7 | Workspace = real-time sync + zero-copy memory + web-native GPU + deterministic replay simultaneamente |

## Technical Context

- **Runtime supportati:** Java (Ghidra/Swing), C/C++ (rea.tools, binwalk, radare2), Python (angr, unicorn), Rust (d810, miasm), WASM (tool portabili)
- **Orchestrazione:** Container isolation per ogni engine, gRPC/API interne per comunicazione cross-engine, shared memory region per zero-copy state
- **Frontend:** Web-native con WebGL/WebGPU per rendering disassembly/graph/CFG, WebSocket per real-time sync, CRDT per collaborative editing
- **Storage:** Knowledge graph database per RE corpus, object storage per binary artifacts, vector DB per semantic search/AI training
- **Security:** Enclave-based isolation, E2E encryption per tenant data, certificate-based mTLS tra microservizi, HSM per key management

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| BinaryArtifact | Core | hash, format, arch, size, upload_ts, owner_team | belongs_to Project, analyzed_by AnalysisSession, stored_in KnowledgeBase |
| AnalysisSession | Core | id, user, team, start_ts, end_ts, engines_used, state_snapshot | operates_on BinaryArtifact, produces Annotation, recorded_as ReplayTimeline |
| Annotation | Core | type, content, author, timestamp, engine_source, confidence | attached_to BinaryArtifact@address, part_of AnalysisSession, linked_to KnowledgeEntry |
| KnowledgeEntry | KB | type (signature/pattern/CVE/malware_family), content, source, verified, tags | references BinaryArtifact, contributed_by Team, used_by AnalysisSession |
| Team | Enterprise | id, name, members[], rbac_policies, encryption_keys, quota | owns Project, contributes_to KnowledgeBase, isolated_from other Teams |
| Project | Enterprise | id, name, team, binaries[], sessions[], created_ts | contains BinaryArtifact, governed_by Team policies |
| ReplayTimeline | Audit | session_id, events[], branches[], checkpoints[] | reproduces AnalysisSession deterministically, auditable_by Compliance |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 3 | 3 | - | - | - |
| 3 | 5 | 2 | 1 | 2 | 40% |
| 5 | 6 | 1 | 2 | 3 | 50% |
| 7 | 7 | 1 | 1 | 5 | 71% |
| Final | 7 | 0 | 0 | 7 | 100% |

Ontology has converged — the same 7 entities appeared in the final 2 rounds with no changes. The domain model is stable.

## Interview Transcript

<details>
<summary>Full Q&A (7 rounds + 1 correction)</summary>

### Round 1
**Q:** Quando dici che REVRA usa rea.tools e Ghidra, cosa intendi esattamente per l'integrazione?
**A:** Headless orchestration — REVRA usa i tool come backend CLI/API senza UI nativa
**Ambiguity:** 75% (Goal: 0.7, Constraints: 0.1, Criteria: 0.1)

### Round 1.5 (User Correction)
**Q:** Clarification from user mid-turn
**A:** REVRA NON DEVE INTEGRARSI, deve integrare tutti quei componenti. REVRA is the unified platform that embeds/incorporates rea.tools, Ghidra, and other OSS RE projects as native internal components.
**Ambiguity:** 64% (Goal: 0.85, Constraints: 0.1, Criteria: 0.1)

### Round 2
**Q:** Quale modello architetturale definisce come REVRA incorpora nativamente tool con runtime così eterogenei?
**A:** Containerized microservices con sandboxing isolato e orchestrazione dinamica (best-in-class)
**Ambiguity:** 49% (Goal: 0.85, Constraints: 0.8, Criteria: 0.1)

### Round 3
**Q:** Qual è l'esperienza d'uso primaria di REVRA che lo rende superiore ai tool standalone?
**A:** Unified multi-tool workspace — unico ambiente dove disassembly, decompilazione, debug, patching e analisi collaborativa coesistono in tempo reale con contesto condiviso
**Ambiguity:** 49% (Goal: 0.85, Constraints: 0.8, Criteria: 0.1)

### Round 4
**Q:** Qual è il contenuto primario della Knowledge Base di REVRA?
**A:** Full RE Corpus — artifact tecnici, collaborazione, dataset pubblici, training data AI, benchmark, knowledge graph
**Ambiguity:** 38% (Goal: 0.9, Constraints: 0.8, Criteria: 0.1)

### Round 5
**Q:** Quale dimensione enterprise distingue REVRA da un tool RE open-source potenziato?
**A:** Tutte e tre combinate al massimo: multi-team collaborative RE platform + scalable analysis infrastructure + compliance-first secure enclave simultaneamente
**Ambiguity:** 30% (Goal: 0.9, Constraints: 0.8, Criteria: 0.1)

### Round 6
**Q:** Quale criterio dimostra che REVRA ha raggiunto l'unificazione reale dei motori RE?
**A:** Tutti e tre al massimo: cross-engine shared state + unified API surface + performance parity/better simultaneamente
**Ambiguity:** 22% (Goal: 0.9, Constraints: 0.8, Criteria: 0.85)

### Round 7
**Q:** Quali vincoli tecnici definiscono l'Analysis Workspace unificato di REVRA?
**A:** Tutti e tre al massimo: real-time sync + zero-copy shared memory + web-native GPU acceleration + deterministic replay con auditability completa
**Ambiguity:** 18% ✅ BELOW THRESHOLD
</details>
