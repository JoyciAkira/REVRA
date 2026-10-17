# ADR 0003 — LLM provider BYOM: nessun costo inference a carico di REVRA

**Data:** 2026-10-15
**Stato:** APPROVATA (decisione owner)

## Decisione

REVRA non bundla né paga inference. Ogni uso di LLM (repair loop, proposer neurali,
analisi assistite) passa da un adapter model-agnostic configurato via environment:

```
REVRA_LLM_BASE_URL   # endpoint compatibile Anthropic Messages o OpenAI Chat
REVRA_LLM_API_KEY
REVLL_LLM_MODEL
REVRA_LLM_PROTOCOL   # anthropic | openai
```

- **Test/sviluppo:** proxy GhostCLI locale (`http://127.0.0.1:18899`, modelli
  claude-sonnet-5/opus-5/fable-5.1, z-ai/glm-5.3, gpt-6-astra). Chiave via env,
  mai nel repo (contract `scripts/secret-scan.sh`).
- **Produzione:** l'utente/deployment porta il proprio modello e la propria chiave
  ("noi la macchina, loro la benzina") — lo stesso modello di costo di REA (tool
  via MCP, modello dell'agente dell'utente).

## Guardrail architetturale (già esistente)

L'**AI Authority Boundary** del kernel (PRD §0) vincola qualsiasi submission LLM a L1:
nessun output del modello viene promosso senza verifica del giudice indipendente
(compilazione, test, prove formali). Conseguenza BYOM-safe: un modello debole produce
meno candidati verificati, mai risultati non verificati. La qualità del modello
dell'utente è una questione di throughput, non di correttezza del sistema.

## Conseguenze

- Nessun margine/costo inference nei pricing tier: il valore venduto è
  kernel+engines+verifica, non token.
- L'adapter espone `model`, `protocol` nei metadata di provenance di ogni claim
  (tracciabilità del "chi ha proposto cosa").
- Benchmark: i run con GhostCLI vanno etichettati con modello e protocollo
  (single-shot vs agentic) nei report; mai mescolare protocolli nelle tabelle.
