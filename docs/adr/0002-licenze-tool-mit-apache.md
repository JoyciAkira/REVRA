# ADR 0002 — Policy licenze tool di terze parti: solo MIT e Apache-2.0

**Data:** 2026-10-15
**Stato:** APPROVATA (decisione owner)
**Contesto:** REVRA integra motori e strumenti RE di terze parti come adapter CLI
out-of-process (schema esistente: adapter con capability `SUPPORTED/DEGRADED`).
La selezione dei candidati dalla lista `morluto/awesome-reverse-engineering`
(566★) richiede una policy di licenza verificata alla fonte (GitHub API, 2026-10-15).

## Decisione

**REVRA dipende solo da tool con licenza MIT o Apache-2.0.**

- Permessi in monorepo: MIT/Apache possono essere vendored/linkati.
- Tool con *altre* licenze open (GPL, NOASSERTION, custom): ammessi **solo come
  processo separato** che consuma output JSON/testo — mai linkati, mai vendored,
  mai copiati nei package. Preferenza: evitarli se esiste alternativa MIT/Apache.

## Set approvato (verificato 2026-10-15)

| Tool | Licenza | Uso in REVRA |
|---|---|---|
| RetDec | MIT | secondo engine decompilazione (output C LLVM-based) |
| LIEF | Apache-2.0 | parse/modify ELF/PE/Mach-O reale (evidenza L0) |
| Triton | Apache-2.0 | symbolic execution/taint per L2 (sostituisce lo stub `triton-symbolic-verifier`) |
| Speakeasy | MIT | emulazione behavioral PE/Windows |
| capa | Apache-2.0 | capability detection a regole → claim L1 con provenance |
| Detect It Easy | MIT | fingerprint compiler/packer |
| FLOSS | Apache-2.0 | recupero stringhe offuscate |

Ghidra (Apache-2.0), Unicorn (BSD-2), Lean (Apache-2.0), Python stdlib: già in uso, conformi.

## Scartati (motivo licenza)

| Tool | Licenza | Alternativa |
|---|---|---|
| Qiling | GPL-2.0 | Unicorn (BSD) + Speakeasy (MIT) coprono emulazione utente/PE |
| ghidriff | GPL-3.0 | diffing via BinExport (Apache) + confronto output engine nel consensus |
| checksec | NOASSERTION | reimplementazione in-house di ~50 righe su `llvm-readobj` |

## Conseguenze

- Ogni nuovo adapter porta nel campo `license` del registro adapter l'SPDX verificato;
  lo script `scripts/install-engines.sh` registra licenza e versione di ciascun tool.
- La valutazione "solo MIT/Apache" vale per le *dipendenze di default*: un deployment
  enterprise può abilitare tool aggiuntivi via configurazione, con la licenza mostrata
  in UI (capability `DEGRADED` se assente, mai silenzio — contratto PRD §0.2).
