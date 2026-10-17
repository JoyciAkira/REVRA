/**
 * A1++.2 — AtomicEvidenceComposer (PRD §0.1, Beyond Limits).
 *
 * Tratta la gerarchia L0→L3 come COMPOSIZIONE di atomi istruzionali verificati
 * (AtomicSemanticsRegistry, A1++.1). Ogni proof L3 è vincolato agli hash
 * semantici degli atomi che tocca: se un atomo cambia (es. semantica corretta
 * in una nuova versione del modulo Lean), SOLO i proof che dipendono da quell'
 * atomo vengono invalidati — gli altri restano L3.
 *
 * Questo è il cuore del principio "atomicità": cambiare 1 istruzione non
 * richiede di rivalutare tutta la funzione, ma solo i proof che la toccano.
 * È la mitigazione strutturale dell'overhead di formal verification (PRD §10).
 *
 * Contratto coerente con PRD §0.2:
 * - No Silent Promotion: un proof resta L3 solo finché tutti i suoi atomi
 *   hanno lo stesso hash semantico registrato al momento della verifica.
 * - Graceful Degradation: se un atomo cambia, il proof degrada esplicitamente
 *   a STALE_ATOMS (nuovo stato speciale) con warning, mai silenziosamente.
 */
import type { AtomicSemanticsRegistry } from './atomic-semantics-registry.js';

/**
 * Stato speciale per un proof i cui atomi sono cambiati dopo la verifica.
 * Non è un fallimento del proof (la logica era corretta al tempo della
 * verifica), ma una stalezza rispetto alla semantica atomica corrente.
 * Coerente col principio "evidenza esplicita, mai silenziosa".
 */
export const ATOMIC_STALE_STATUS = 'STALE_ATOMS' as const;
export type AtomicStaleStatus = typeof ATOMIC_STALE_STATUS;

export interface AtomicProofBinding {
  /** Id del result/proof nel kernel. */
  readonly proofId: string;
  /** Hash semantici degli atomi su cui questo proof si fonda, al momento della verifica. */
  readonly atomHashes: ReadonlyArray<string>;
  /** Nomi degli atomi (per diagnostica umana; l'identità reale è l'hash). */
  readonly atomNames: ReadonlyArray<string>;
}

export interface AtomicCompositionResult {
  /** Proof ancora valido: tutti gli atomi mantengono lo stesso hash semantico. */
  readonly valid: boolean;
  /** Atomi il cui hash è cambiato rispetto al binding (vuoto se valid=true). */
  readonly staleAtoms: ReadonlyArray<{ name: string; boundHash: string; currentHash?: string }>;
}

export class AtomicEvidenceComposer {
  constructor(private readonly registry: AtomicSemanticsRegistry) {}

  /**
   * Registra un proof L3 vincolandolo agli hash semantici correnti degli atomi
   * che dichiara di toccare. Gli atomi devono esistere nel registry, altrimenti
   * lancia (mai silente: un proof su atomi inesistenti è un errore esplicito).
   */
  bindProof(proofId: string, atomNames: ReadonlyArray<string>): AtomicProofBinding {
    const atomHashes: string[] = [];
    const resolvedNames: string[] = [];
    for (const name of atomNames) {
      const atom = this.registry.getByName(name);
      if (!atom) {
        throw new Error(
          `AtomicEvidenceComposer: atomo "${name}" non registrato nel registry ` +
            `(proof ${proofId} non può essere vincolato a semantica inesistente)`,
        );
      }
      atomHashes.push(atom.semanticHash);
      resolvedNames.push(atom.name);
    }
    return { proofId, atomHashes, atomNames: resolvedNames };
  }

  /**
   * Verifica se un proof vincolato è ancora valido rispetto allo stato corrente
   * del registry. Un proof è valido SOLO se ogni atomo mantiene lo stesso hash
   * semantico registrato al bind. Se un atomo è cambiato (o rimosso), il proof
   * è STALE: degrada esplicitamente, gli altri proof restano L3.
   *
   * Questo è il gate composizionale: modificare 1 atomo invalida solo i proof
   * che lo includono, non l'intero corpus di verifiche formali.
   */
  checkBinding(binding: AtomicProofBinding): AtomicCompositionResult {
    const staleAtoms: Array<{ name: string; boundHash: string; currentHash?: string }> = [];
    for (let i = 0; i < binding.atomNames.length; i++) {
      const name = binding.atomNames[i];
      const boundHash = binding.atomHashes[i];
      if (name === undefined || boundHash === undefined) continue;
      const current = this.registry.getByName(name);
      if (!current) {
        // Atomo rimosso dal registry: il proof non ha più fondamento semantico.
        staleAtoms.push({ name, boundHash, currentHash: undefined });
        continue;
      }
      if (current.semanticHash !== boundHash) {
        // Atomo presente ma semantica cambiata: proof stale per questo atomo.
        staleAtoms.push({ name, boundHash, currentHash: current.semanticHash });
      }
    }
    return { valid: staleAtoms.length === 0, staleAtoms };
  }

  /**
   * Composizione di due binding: il proof composto è vincolato all'unione degli
   * atomi dei due proof. Dimostra che gli atomi si COMpongono: una sequenza
   * mov+add è vincolata agli atomi {mov, add}, e resta valida finché entrambi
   * mantengono il loro hash.
   */
  composeBindings(...bindings: AtomicProofBinding[]): AtomicProofBinding {
    const seen = new Map<string, string>();
    const names: string[] = [];
    const hashes: string[] = [];
    for (const b of bindings) {
      for (let i = 0; i < b.atomNames.length; i++) {
        const name = b.atomNames[i];
        const hash = b.atomHashes[i];
        if (name === undefined || hash === undefined) continue;
        if (!seen.has(name)) {
          seen.set(name, hash);
          names.push(name);
          hashes.push(hash);
        }
      }
    }
    return { proofId: bindings.map((b) => b.proofId).join('+'), atomHashes: hashes, atomNames: names };
  }
}