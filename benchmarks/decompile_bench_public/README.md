# Benchmark pubblico: HumanEval-Decompile (Decompile-Bench-Eval, LLM4Binary)

Valutazione honest di REVRA sul protocollo pubblico di [LLM4Decompile/Decompile-Bench](https://arxiv.org/abs/2505.12668)
(corpus: `decompile-bench/data/humaneval-decompile.json`, 1312 righe = 164 funzioni × 4 opt × {c,cpp}, SHA-256 pinnato in `setup.sh`).

## Perché esiste

I claim interni P1 (F1.1 "100%", proof Lean "100%") sono misurati su corpus sintetico
con: (a) un proposer stub (`CalibratedNeuralProposer` emette `int sub_x(void){return 0;}`),
(b) un verifier strutturale che controlla solo le parentesi bilanciate, (c) proof Lean
hardcodati (`theorem ... : True := by trivial`) selezionati per nome funzione dal ground
truth. Nessuno di questi misura decompilazione. Questo banco misura REVRA su corpus
pubblico, protocollo identico alla letteratura, candidati reali.

## Protocollo (identico all'ufficiale)

- Harness: `execute_rate` verbatim da `decompile-bench/metrics/cal_execute_rate.py` (MIT),
  in container linux/amd64 (`setup.sh` costruisce l'immagine con g++/gcc, boost, openssl).
- Candidato compilato `func_dep + candidato + test`, **-O0** (default ufficiale),
  `-std=c++17 -lm -lcrypto` per cpp, timeout 10s; re-executable = exit 0.
- `opt` della riga = livello di ottimizzazione del binario originale (input della
  decompilazione), non del ricompilato — come nel protocollo ufficiale.

## Tre set di candidati sullo stesso corpus

| Set | Origine | Significato |
|-----|---------|-------------|
| `ida` | colonna `ida_pseudo` del corpus (Hex-Rays, rilasciata dagli autori) | baseline IDA/Hex-Rays — il paper (Tabella 2) riporta AVG 18.22% su HumanEval |
| `ghidra` | colonna `ghidra_pseudo` del corpus | baseline Ghidra — paper: AVG 13.57% |
| `revra` | ricostruzione binari + **Ghidra headless 12.1.4** locale (unico motore di decompilazione reale di REVRA), stessa harness | il numero REVRA vero su corpus pubblico |

Riprodurre `ida` e `ghidra` localmente calibra la fedeltà del protocollo: se i nostri
numeri per `ida`/`ghidra` cadono sugli intervalli del paper, il numero `revra` è
confrontabile alla stessa stregua.

## Uso

```bash
bash setup.sh                                   # corpus (sha256 verificato) + immagine docker
python3 baseline_official.py                    # baseline ida + ghidra (smoke: --limit 12)
python3 revra_run.py                            # pipeline REVRA: build -> ghidra headless -> harness
```

Output in `reports/` (gitignored): `official_baselines.json`, `revra_summary.json`,
per-riga `*_results.jsonl`. Intervalli Wilson 95% su ogni aggregato.

## Limitazioni dichiarate

- macOS arm64 host: i binari originali sono ricompilati in container linux/amd64
  (stessa toolchain del protocollo); la decompilazione Ghidra gira nativa (Ghidra non
  esegue i binari, li parsa). Le versioni di gcc/g++ nel container (Ubuntu 22.04) possono
  differire da quelle usate per generare le colonne `asm`/`*_pseudo` del corpus: per
  questo riproduciamo PRIMA le baseline dalle colonne rilasciate, poi confrontiamo.
- Ghidra 12.1.4 locale ≠ versione Ghidra degli autori (11.x, 2025): piccole differenze
  attese; per questo il set `ghidra` (loro output) resta il riferimento citabile.
- REVRA kernel (L0→L1, provenance) registra i claim; sul numero re-executability il
  kernel non incide: la metrica misura il motore di decompilazione.
