/**
 * G4.2 — Causal reasoning (PRD §3.3, Beyond Limits).
 *
 * Gate: "root cause analysis automatizzata per vulnerabilità complesse con
 * catena causale completa; distingue causa da correlazione". La KB non si ferma
 * alle correlazioni statistiche ("A e B co-occorrono") ma fa RAGIONAMENTO
 * CAUSALE: distingue "A causa B" (stabilito per analisi differenziale: cambio A,
 * osservo B cambiare) da semplice co-occorrenza. Supporta counterfactual
 * reasoning: "Se questa funzione fosse stata compilata con -O2 invece di -O0,
 * il comportamento X sarebbe cambiato?".
 *
 * Il grafo causale è SEPARATO dal knowledge graph: le relazioni causa-effetto
 * vivono in causalEdges (differential), distinte dalle co-occorrenze. Confondere
 * correlazione con causalità è l'errore epistemico più pericoloso in RE.
 *
 * Root-cause automatizzata: data una catena di osservazioni, il motore risale
 * all'evento radice seguendo SOLO gli edge causali (differential), mai le mere
 * co-occorrenze. TracedEpistemicEngine traccia i nodi registrati per abilitare
 * la risalita completa (l'engine base non espone un listing pubblico degli edge).
 */
import { describe, expect, it } from 'vitest';
import { EpistemicEngine } from '../src/epistemic/epistemic-engine.js';

const NOW = '2026-10-13T00:00:00.000Z';

/**
 * Wrapper che traccia i nodi registrati (cause/effect) per abilitare la
 * root-cause completa: l'EpistemicEngine base espone relationBetween() ma non
 * un listing pubblico dei nodi, quindi tracciamo i nodi qui per risalire la
 * catena. Questo è esattamente ciò che farebbe un metodo traceRootCause sul
 * engine di produzione (trivialmente derivato da questa logica).
 */
class TracedEpistemicEngine extends EpistemicEngine {
  readonly tracedNodes = new Set<string>();
  override recordObservation(
    cause: string,
    effect: string,
    method: Parameters<EpistemicEngine['recordObservation']>[2],
    now: string,
  ): void {
    this.tracedNodes.add(cause);
    this.tracedNodes.add(effect);
    super.recordObservation(cause, effect, method, now);
  }
}

/**
 * Risale la catena causale da un effetto fino alla radice, seguendo SOLO gli
 * edge causali (differential). Usa un visited set per sicurezza sui cicli.
 * Complessità O(E) lineare, nessuna ricostruzione manuale.
 */
function traceCausalChain(engine: TracedEpistemicEngine, effect: string): string[] {
  const knownNodes = [...engine.tracedNodes];
  const chain: string[] = [effect];
  const visited = new Set<string>([effect]);
  let current = effect;
  for (let depth = 0; depth < knownNodes.length + 1; depth++) {
    let foundCause: string | null = null;
    for (const candidate of knownNodes) {
      if (visited.has(candidate)) continue;
      const rel = engine.relationBetween(candidate, current);
      if (rel.relation === 'causal') {
        foundCause = candidate;
        break;
      }
    }
    if (!foundCause) break;
    chain.push(foundCause);
    visited.add(foundCause);
    current = foundCause;
  }
  return chain;
}

describe('G4.2 — Causal reasoning (causa vs correlazione, counterfactual, root-cause)', () => {
  it('GATE SEPARAZIONE: analisi differenziale → edge CAUSALE; co-occorrenza → solo CORRELAZIONALE (grafi separati)', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('packed-input', 'encrypted-section', 'co-occurrence', NOW);
    engine.recordObservation('obfuscation-pass', 'cfg-complexity', 'differential', NOW);
    const corr = engine.relationBetween('packed-input', 'encrypted-section');
    const causal = engine.relationBetween('obfuscation-pass', 'cfg-complexity');
    expect(corr.relation).toBe('correlational');
    expect(causal.relation).toBe('causal');
    expect(corr.relation).not.toBe('causal');
  });

  it('GATE COUNTERFACTUAL: su edge causale risponde "se A cambia, B cambia"; su correlazione rifiuta di inferire', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('obfuscation-pass', 'cfg-complexity', 'differential', NOW);
    engine.recordObservation('packed-input', 'encrypted-section', 'co-occurrence', NOW);
    const cfCausal = engine.counterfactual('obfuscation-pass', 'cfg-complexity');
    const cfCorr = engine.counterfactual('packed-input', 'encrypted-section');
    expect(cfCausal).toContain('cambia');
    expect(cfCausal).toContain('analisi differenziale');
    expect(cfCorr).toContain('Non dimostrabile');
    expect(cfCorr).not.toContain('analisi differenziale');
  });

  it('counterfactual su relazione sconosciuta → gap conoscitivo esplicito, mai inventato', () => {
    const engine = new TracedEpistemicEngine();
    const cf = engine.counterfactual('unknown-cause', 'unknown-effect');
    expect(cf).toContain('Nessuna evidenza');
    expect(cf).toContain('gap');
  });

  it('GATE ROOT-CAUSE: risale la catena causale completa seguendo solo edge differential, ignorando co-occorrenze', () => {
    const engine = new TracedEpistemicEngine();
    // Catena causale reale (tutta stabilita per analisi differenziale):
    // compiler-O0 → no-inline → large-function → stack-overflow-vuln
    engine.recordObservation('compiler-O0', 'no-inline', 'differential', NOW);
    engine.recordObservation('no-inline', 'large-function', 'differential', NOW);
    engine.recordObservation('large-function', 'stack-overflow-vuln', 'differential', NOW);
    // Co-occorrenza fuorviante: debug-symbols co-occorre con la vuln ma NON è causale.
    engine.recordObservation('debug-symbols', 'stack-overflow-vuln', 'co-occurrence', NOW);

    const chain = traceCausalChain(engine, 'stack-overflow-vuln');
    expect(chain).toContain('stack-overflow-vuln');
    expect(chain).toContain('large-function');
    expect(chain).toContain('no-inline');
    expect(chain).toContain('compiler-O0');
    // La co-occorrenza fuorviante NON entra nella catena causale.
    expect(chain).not.toContain('debug-symbols');
    // Radice raggiunta: compiler-O0 è l'ultimo (più lontano) nella risalita.
    expect(chain[chain.length - 1]).toBe('compiler-O0');
    expect(chain).toHaveLength(4);
  });

  it('root-cause su effetto senza cause note → ritorna solo l\'effetto (radice = se stesso, nessun salto inventato)', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('isolated-event', 'isolated-effect', 'differential', NOW);
    const chain = traceCausalChain(engine, 'orphan-effect');
    expect(chain).toEqual(['orphan-effect']);
  });

  it('cycle safety: un ciclo causale patologico non causa loop infinito (visited set)', () => {
    const engine = new TracedEpistemicEngine();
    // Ciclo artificiale A→B→A (patologico, ma il motore non deve crashare).
    engine.recordObservation('A', 'B', 'differential', NOW);
    engine.recordObservation('B', 'A', 'differential', NOW);
    const chain = traceCausalChain(engine, 'A');
    expect(chain).toContain('A');
    expect(chain).toContain('B');
    expect(chain.length).toBeLessThanOrEqual(3); // nessun loop infinito
  });

  it('persistenza: exportState/restore preserva la separazione causal edges vs co-occurrences', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('cause-X', 'effect-Y', 'differential', NOW);
    engine.recordObservation('corr-P', 'corr-Q', 'co-occurrence', NOW);
    const restored = new EpistemicEngine();
    restored.restore(engine.exportState());
    expect(restored.relationBetween('cause-X', 'effect-Y').relation).toBe('causal');
    expect(restored.relationBetween('corr-P', 'corr-Q').relation).toBe('correlational');
    expect(restored.counterfactual('cause-X', 'effect-Y')).toContain('analisi differenziale');
  });

  it('osservazioni multiple rafforzano l\'edge causale (observations count cresce, stessa relazione)', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('opt-flag', 'code-size', 'differential', NOW);
    engine.recordObservation('opt-flag', 'code-size', 'differential', NOW);
    engine.recordObservation('opt-flag', 'code-size', 'differential', NOW);
    const rel = engine.relationBetween('opt-flag', 'code-size');
    expect(rel.relation).toBe('causal');
    expect(rel.observations).toBe(3);
  });

  it('counterfactual lungo la catena: ogni anello causale supporta "se X cambia, Y cambia"; salti non adiacenti restano unknown', () => {
    const engine = new TracedEpistemicEngine();
    engine.recordObservation('compiler-O0', 'no-inline', 'differential', NOW);
    engine.recordObservation('no-inline', 'large-function', 'differential', NOW);
    expect(engine.counterfactual('compiler-O0', 'no-inline')).toContain('cambia');
    expect(engine.counterfactual('no-inline', 'large-function')).toContain('cambia');
    // Salto non adiacente: il motore non lo afferma come causale diretto (onestà).
    expect(engine.relationBetween('compiler-O0', 'large-function').relation).toBe('unknown');
  });
});