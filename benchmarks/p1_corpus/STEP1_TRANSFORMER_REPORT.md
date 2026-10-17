# STEP 1 Report: Transformer Fine-Tuning vs Rule-Based Pipeline

**Data:** 2026-10-15  
**Obiettivo:** Verificare se un transformer fine-tuned (CodeGen-350M-mono + LoRA) può sostituire o migliorare il pipeline rule-based esistente per la decompilazione con proof formale Lean allegato.

## Risultati Benchmark

### Transformer Fine-Tuned (CodeGen-350M-mono + LoRA r=16)
- **Training:** 3 epochs, 735 sample (661 train / 74 val), MPS Apple Silicon
- **Loss finale:** Train=0.38, Val=0.10 (segnale di overfitting)
- **Benchmark inferenza (5 binari campione):**
  - `aes_encrypt_round_O0_extreme.hard`: ❌ C=False, Lean=False
  - `aes_encrypt_round_O0_heavy.hard`: ❌ C=True, Lean=False
  - `aes_encrypt_round_O0_light.hard`: ❌ C=True, Lean=False
  - `aes_encrypt_round_O0_medium.hard`: ❌ C=True, Lean=False
  - `aes_encrypt_round_O0_none.hard`: ❌ C=False, Lean=False
- **Totale validi:** 0/5 (0%)
- **Tempo inferenza:** ~18s/binario (troppo lento per produzione)
- **Problemi riscontrati:**
  1. Output C generato ma semanticamente errato o incompleto
  2. **Nessuna prova Lean generata** (campo `proof_lean` sempre vuoto o assente)
  3. Overfitting evidente: val_loss=0.10 ma output irrilevanti su dati unseen
  4. Capacità insufficiente: 350M parametri non bastano per task asm→C+proof

### Rule-Based Pipeline (CalibratedNeuralProposer + Platt scaling)
- **Corpus testato:** 735 binari ARM64 LLVM IR obfuscati
- **Proof coverage:** 100% (735/735 binari con proof Lean 4 full-function)
- **Funzioni uniche verificate:** 49/49 (100%)
- **Tempo medio:** <1s/binario
- **Comparazione vs SOTA:**
  - FoxDec (CCS 2024): 93.75% ma solo basic-block level, 16 binari
  - REVRA rule-based: 100% full-function level, 735+ binari

## Verdetto

**Gap 2 (Beyond Limits - Neural Proposer con proof formale):**
- ❌ **Transformer 350M fine-tuned: NON chiude il gap** (0% proof coverage, output errati)
- ✅ **Rule-based pipeline: CHIÚDE il gap** (100% proof coverage formale Lean 4)

**Raccomandazione:**
1. **Consolidare il rule-based esistente** come soluzione definitiva per P1
2. **Abbandonare l'approccio transformer 350M** per questo task specifico
3. **Eventuale futuro:** valutare modelli più grandi (7B+) con dataset 10x più ampio e training multi-GPU, ma solo se il rule-based mostra limiti su corpus più complessi

## Evidenze Allegate
- Checkpoint LoRA: `benchmarks/p1_corpus/lora_checkpoint/best_model`
- Dataset training: `benchmarks/p1_corpus/finetune_dataset.jsonl` (735 sample)
- Report Lean 4: `benchmarks/p1_corpus/report.json` (100% coverage)
- Benchmark comparativo: eseguito 2026-10-15, 5 binari campione, 0/5 validi per transformer

## Conclusione Onesta

Il tentativo di integrare un transformer fine-tuned come drop-in replacement del rule-based **è fallito**. Il modello 350M non ha capacità sufficiente per generare contemporaneamente pseudocodice C corretto E proof formale Lean allegato. Il pipeline rule-based esistente (CalibratedNeuralProposer con Platt scaling + verificatore Lean 4) rimane la soluzione superiore con 100% proof coverage su 735 binari.

**Gap 2 status:** CHIUSO dal rule-based, NON chiuso dal transformer. La roadmap P1 procede con il consolidamento del pipeline esistente, non con l'integrazione del transformer.

---
*Report generato automaticamente da REVRA Agent - Senior Full-Stack Developer*