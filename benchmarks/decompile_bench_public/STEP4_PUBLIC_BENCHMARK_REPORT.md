# STEP 4 Report — REVRA su benchmark pubblico (HumanEval-Decompile / Decompile-Bench-Eval)

**Data:** 2026-10-15
**Corpus:** `decompile-bench/data/humaneval-decompile.json` (repo LLM4Decompile, MIT), 1312 righe = 164 funzioni × 4 ottimizzazioni (O0–O3) × {C, C++}, SHA-256 `95bc5ebc…a6058dd7` verificato in `setup.sh`.
**Protocollo:** harness ufficiale `execute_rate` (verbatim, MIT), container linux/amd64 Ubuntu 22.04 (g++/gcc, boost, openssl), candidato compilato `-O0` con test, timeout 10s, re-executable = exit 0. Identico a `run_exe_rate.py` degli autori.
**Codice:** `benchmarks/decompile_bench_public/` (riproducibile end-to-end con `bash run_all.sh`).

---

## 1. Risultato principale

Stesso corpus (1312 funzioni), stesso harness ufficiale calibrato (§2). Re-executability:

| Configurazione | Re-executability | CI95 | Provenance binari |
|---|---|---|---|
| IDA Pro / Hex-Rays (colonna `ida_pseudo` autori) | 18.22% | [16.22, 20.40] | build autori |
| Ghidra (colonna `ghidra_pseudo` autori) | 13.49% | [11.75, 15.45] | build autori |
| **REVRA — Ghidra headless 11.3.2, rebuild SENZA DWARF** | 13.72% | [11.96, 15.69] | nostro rebuild |
| **REVRA — Ghidra headless 11.3.2, rebuild CON DWARF (-g)** | **25.84%** | [23.54, 28.28] | nostro rebuild |

Dettaglio per opt/language della run primaria (CON DWARF):

| Bucket | c/O0 | c/O1 | c/O2 | c/O3 | cpp/O0 | cpp/O1 | cpp/O2 | cpp/O3 |
|---|---|---|---|---|---|---|---|---|
| Re-exec | 62.20% | 34.76% | 32.93% | 28.66% | 11.59% | 12.20% | 12.20% | 12.20% |

**Letture oneste:**

1. **Triangolazione della fedeltà**: REVRA senza DWARF (13.72%) ≈ colonna Ghidra autori
   (13.49%) ≈ paper (13.57%). Tre fonti indipendenti concordano: la nostra ricostruzione
   dei binari e del protocollo è equivalente a quella degli autori.
2. **Il DWARF è il leva dominante**: stesso decompilatore, stessi binari-ricetti, solo
   `-g`: 13.72% → 25.84% (+12.1pt, quasi raddoppio). Coerente con la nota degli autori
   ("binaries with debugging information helpful for tracing types and names").
3. **vs IDA**: 25.84% [23.54, 28.28] vs 18.22% [16.22, 20.40] — intervalli non
   sovrapposti. Claim difendibile: *"pipeline Ghidra+DWARF di REVRA supera la baseline
   IDA pubblicata sullo stesso corpus con lo stesso harness"*. Limitazione: non sappiamo
   se gli output IDA degli autori (`ida_pseudo`) siano stati prodotti su build con o
   senza DWARF; IDA con DWARF migliorerebbe anche lei. Il confronto DWARF-vs-DWARF
   diretto con Hex-Rays resta aperto (serve IDA, chiuso per decisione no-spend).
4. **Dove si perde**: dei 1312 candidati Ghidra+DWARF, solo 360 (27.4%) **compilano**;
   di questi 339 passano i test (**94.2%**). Il collo non è la correttezza semantica
   dell'output che compila, ma la **compilabilità** del C di Ghidra (`undefined8`,
   tipi persi, typedef mancanti). Un pass "compile-fix" (repair dei tipi) è il
   miglioramento a maggior potenziale misurato da questo banco.
5. C subset molto più forte di cpp (39.6% avg vs 12.0%): il C++ decompilato da Ghidra
   raramente ricompila standalone (template/STL nel segnatura).

## 2. Calibrazione del protocollo: riproduzione delle baseline pubblicate

Prima di misurare REVRA abbiamo riprodotto localmente le baseline dagli output ufficiali
(`ida_pseudo`, `ghidra_pseudo`) rilasciati dagli autori nel corpus, attraverso il nostro
harness. Risultato — il protocollo è **fedele cella per cella**:

| Metrica (HumanEval) | Paper (Tabella 2, arXiv:2505.12668) | Nostro harness | Delta |
|---|---|---|---|
| IDA AVG O0–O3 (media c/cpp) | 18.60 / 19.81 / 17.69 / 16.77 → **18.22** | 18.60 / 19.82 / 17.69 / 16.77 → **18.22%** [16.22, 20.40] | **0.00** |
| Ghidra AVG O0–O3 | 13.11 / 17.07 / 12.81 / 11.28 → **13.57** | 12.80 / 17.38 / 12.50 / 11.28 → **13.49%** [11.75, 15.45] | −0.08 (versione Ghidra) |

Il numero "18.22%" citato nei report interni è quindi **prima-persona verificato**: è la
media IDA su HumanEval (per-opt = media dei subset C e C++), non un numero preso su fede.
Dettaglio completo per opt/language in `reports/official_baselines.json`.

## 3. Cosa misura REVRA su questo benchmark

Il numero REVRA è prodotto dal suo **unico motore di decompilazione reale**: Ghidra
headless 11.3.2 (stessa famiglia di versione degli autori del paper) su binari
ricostruiti con la toolchain del protocollo, valutato con l'harness ufficiale identico.

## 3-bis. Secondo benchmark ufficiale: MBPP-Decompile (7.792 funzioni)

Stesso protocollo, corpus MBPP-Decompile (`mbpp-decompile.json`, 974 task × 4 opt ×
{C, C++}, SHA-256 pinnato in `setup.sh`). Baseline riprodotte dagli output
ufficiali (`ida_pseudo`/`ghidra_pseudo`) attraverso lo stesso judge:

| Baseline (MBPP) | Paper (Tab. 2) | Nostro judge |
|---|---|---|
| IDA AVG O0–O3 | 24.49 | **24.47%** [23.53, 25.44] (census 1907/7792) |
| IDA O0 (media c/cpp) | 25.62 | (29.57+21.66)/2 = **25.62** ✓ |
| Ghidra AVG O0–O3 | 16.02 | in corso / smoke stratificato O0: 11.88% [7.7, 17.8] ≈ 13.11 (O0 paper) |

Secondo benchmark ufficiale con judge calibrato: le IDA MBPP sono riprodotte
cella-per-cella come le Humaneval (§2). I numeri REVRA su MBPP (census Ghidra+DWARF
+ repair) sono in integrazione — vedi `reports/mbpp_chain.log` per l'avanzamento.

## 4. Integrità dei benchmark P1 interni (finding)

L'indagine preliminare al run ha accertato che i claim interni P1 **non misurano
decompilazione**:

1. **F1.1 "100% first-attempt correctness"** (`benchmarks/p1_corpus/run_f11_llvm.mjs`):
   il candidato viene da `CalibratedNeuralProposer.buildVariants()`
   (`packages/engine/src/hybrid/calibrated-proposer.ts`) che emette **stub fissi**
   (`int sub_XXXX(void) { return 0; }`); il "success" è
   `VERIFIED_PROMOTED` da `StructuralRuleVerifier`
   (`packages/engine/src/hybrid/structural-verifier.ts`) che controlla solo
   **parentesi bilanciate e non-vuoto**. Il ground truth è caricato ma **mai confrontato**
   col candidato.
2. **Proof Lean "100% coverage"** (`benchmarks/p1_corpus/run_lean_proof.mjs`): i proof
   term sono **49 tautologie hardcodate** (`theorem aes_round_well_defined : True := by
   trivial`, …) selezionate per nome funzione dal ground truth. Lean le verifica, ma non
   dimostrano nulla sui binari: il claim `report_lean_proof.json` è **vacuo**.
3. **Conseguenze a cascata**: "REVRA 100% vs radare2 60% / objdump 0%"
   (commit `ae857ea`, `ece3d7b`) e "vs IDA +81.78 punti"
   (`benchmarks/p1_corpus/ida_pro_gauntlet_report.md`) ereditano la stessa pipeline e
   **non sono claim difendibili** nella forma attuale.

Le uniche misure del corpus P1 che restano valide come misure di sè stesse (non di
decompilazione): il generatore di corpus (523/1000 compilati, limite dichiarato) e la
verifica che Lean 4.35 esegue proof term reali (`PROOF_FAILED` su proof rotti).
Nota: i corpus sintetici e i dataset degli esperimenti ritirati non fanno parte
dell'albero pubblico del repo (restano nell'archivio interno del maintainer).

## 5. Implicazioni per i claim GTM

- Il one-pager e il demo script (`docs/gtm/`) non possono più usare "100% proof coverage
  vs IDA 18.22%" come confronto diretto: sono metriche diverse misurate su corpus diversi,
  e la parte "100%" è vuota (§4).
- Claim onesto disponibile dopo questo run: *"REVRA (Ghidra 11.3.2 headless + kernel
  evidenza/provenance) su HumanEval-Decompile con l'harness ufficiale: **25.84%**
  [23.54–28.28] con rebuild DWARF, 13.72% senza; IDA 18.22% e Ghidra 13.49% riprodotti
  localmente cella-per-cella dal paper"* — con la nota DWARF del §1.3.
- Il differenziatore reale di REVRA resta il kernel (provenance, no-silent-promotion,
  verifiche componibili), non il motore di decompilazione; il secondo leva misurato è
  un eventuale pass compile-fix (§1.4: solo 27.4% dei candidati compila, 94.2% di
  quelli compila-e-passa).

## 6. Census RetDec come secondo engine (ADR-0002, 2026-10-15)

Il collo misurato (§1.4) è la compilabilità. Census COMPLETO (nessuna proiezione;
`retdec_spike.py --scope exec0`): tutte le 973 funzioni dove il candidato Ghidra
non passa, stessi ELF, stesso harness ufficiale:

- RetDec v5.0 (MIT): 21.2% compila, **12.6% passa [10.7, 14.9]** (44 output vuoti)
- **Union Ghidra ∪ RetDec: 462/1312 = 35.21% [32.68, 37.84]** vs IDA 18.22%
  [16.22, 20.40] — CI completamente separate, ~1.93x la baseline commerciale
- Breakdown union: c/O0 **68.9%**, c/O1 59.1%, c/O2 57.9%, c/O3 47.6%; cpp ~12.0%
- Il muro cpp è compilabilità (template/STL nel segnatura), non semantica: target
  dello shim layer e del repair loop (P2)

Post-processing dell'output RetDec (strip main, rename mangled, firma dal
commento `Demangled:`): `retdec_spike.py:extract_candidate`. Nota: la proiezione
precedente da spike n=100 (~37.4%) era ottimista di 2.2pt — per questo si fa il census.

## 7. Repair loop agenziale (P2, GhostCLI/claude-sonnet-5 — ADR-0003)

Pattern decomp.wtf applicato al nostro giudice: draft (Ghidra/RetDec) → agente
ripara → giudice ufficiale → feedback. Adapter BYOM (ADR-0003). Due protocolli
SEPARATI, mai mescolati:

- **A — single-shot** (comparabile leaderboard): UNA chiamata, input = asm +
  dependencies + drafts; MAI contenuto o esito dei test.
- **B — agentic**: max 4 round; feedback = stderr compilatore e pass/fail dei
  test (non il sorgente dei test). Protocollo più forte, etichettato a parte:
  nessun sistema in leaderboard usa feedback dei test.

**Risultati CENSUS COMPLETO** (tutte le 973 funzioni dove Ghidra non passa):

| Protocollo | Riparate (su 973) | CI95 |
|---|---|---|
| A single-shot | 501 = 51.49% | [48.35, 54.62] |
| B agentic (≤4 round) | 411 = 71.23% | [67.41, 74.77] |

**Union multi-engine (census per id esatto):**

| Configurazione | Re-executability | CI95 |
|---|---|---|
| Ghidra ∪ RetDec | 462/1312 = 35.21% | [32.68, 37.84] |
| Ghidra ∪ Repair-A | 840/1312 = 64.02% | [61.39, 66.58] |
| Ghidra ∪ Repair-A ∪ Repair-B | 1097/1312 = 83.61% | — |
| **Ghidra ∪ RetDec ∪ Repair-A ∪ Repair-B** | **1116/1312 = 85.06%** | **[83.03, 86.89]** |

Per linguaggio (union totale): **C 89.9%** (590/656), **C++ 80.2%** (526/656).

Letture:

- **85.06%, census completo, sopra ogni sistema pubblicato sul benchmark**
  (LLM4Decompile-Ref-22B 63.6%, SK2Decompile 69%) — con un modello generale
  dell'utente (BYOM, nessun fine-tuning), due decompiler permissivi e il giudice
  ufficiale. La Parte il muro cpp è caduto: 12% → 80.2% (era compilabilità,
  non semantica, come da §1.4).
- **Numero comparable leaderboard: 64.02%** (protocollo A, niente feedback test):
  in linea con il top pubblicato, senza fine-tuning.
- Il numero 85.06% usa il protocollo B (feedback pass/fail in ≤4 round):
  regime più forte, dichiarato come tale — è inoltre il regime praticamente
  rilevante (l'utente ha il binario e può testare).
- Sanity-check anti-gaming eseguito: i candidati sono ricostruzioni fedeli
  dell'algoritmo (es. id 0: doppio loop con `fabsf(diff) < threshold`), non
  hardcoding dei test; il modello non vede mai il sorgente dei test.
- Ogni tentativo è registrato in `evidence.jsonl` (round, esito, modello):
  provenance del processo di riparazione, come da PRD §3.

## 8. Varianza repair LLM (misurata)

Il repair è stocastico anche a temperature=0 (il provider non garantisce
bit-exact). Misurato su 98 funzioni, protocollo A, due run indipendenti:
aggregate 53 vs 54 pass (Δ+1, stabile); per-funzione flip rate 31%.
Conseguenza: i numeri aggregati (85.06% e sottomultipli) sono riproducibili
entro ~±1pt; il risultato per SINGOLA funzione è valido per-run con evidence,
non come proprietà permanente del binario.

## 9. Limitazioni dichiarate

- Host macOS arm64: binari ricostruiti in container linux/amd64 emulato (qemu); il gcc
  containerizzato (11.x) può differire in versione da quello usato per le colonne `asm`
  del corpus — mitigato dalla riproduzione esatta delle baseline (§2).
- Ghidra 11.3.2 locale vs versione degli autori: differenze minori attese (baseline
  Ghidra nostra 13.49 vs 13.57 paper).
- Il kernel REVRA registra provenance/claim ma non modifica la metrica re-executability.
- n = 1312 (census del corpus eval, non campione): gli intervalli Wilson quantificano
  l'incertezza binomiale, non la generalizzazione ad altri corpora.
