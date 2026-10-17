/**
 * A1++.3 — AtomicReconciler (PRD §0.1 Conflict Visibility, Beyond Limits).
 *
 * Confronta i risultati di motori diversi (Ghidra, radare2, etc.) a livello
 * ISTRUZIONALE atomico, non a livello di funzione. Se due motori disagree su
 * un indirizzo specifico, il reconciler produce un verdetto `DISPUTED` preciso
 * con la ragione semantica (es. "add modifica i flag, lea no").
 *
 * Questo risolve il pain #1 dei prospect defense/finance: "Ghidra e radare2
 * disagree e non so a chi credere". Invece di un vago "le funzioni differiscono",
 * REVRA dice esattamente QUALE atomo istruzionale è in disputa e PERCHÉ
 * semanticamente.
 *
 * Contratto coerente con PRD §0.1:
 * - Conflict Visibility: le discrepanze sono esposte come DISPUTED atomico,
 *   mai nascoste o mediate silenziosamente.
 * - Evidence Hierarchy: ogni claim istruzionale porta il suo motore sorgente
 *   e il suo hash semantico atomico (da AtomicSemanticsRegistry).
 */
import type { AtomicSemanticsRegistry, AtomicSemantics } from './atomic-semantics-registry.js';

export type ReconciliationVerdict = 'AGREED' | 'DISPUTED';

export interface InstructionClaim {
  /** Motore che ha prodotto il claim (es. "ghidra", "radare2"). */
  readonly engine: string;
  /** Indirizzo dell'istruzione nel binario. */
  readonly address: string;
  /** Byte opcode osservati (L0 evidence). */
  readonly opcodeBytes: ReadonlyArray<number>;
  /** Nome dell'atomo semantico risolto dal registry (es. "add_reg_reg"). */
  readonly atomName: string;
}

export interface AtomicDispute {
  /** Indirizzo dove i motori disagree. */
  readonly address: string;
  /** Claim del primo motore. */
  readonly claimA: InstructionClaim;
  /** Claim del secondo motore. */
  readonly claimB: InstructionClaim;
  /** Ragione semantica della disputa (es. "add modifica CF/ZF, lea no"). */
  readonly semanticReason: string;
  /** Hash semantici degli atomi in disputa (per diagnostica). */
  readonly hashA: string;
  readonly hashB: string;
}

export interface AtomicReconciliationResult {
  readonly verdict: ReconciliationVerdict;
  /** Atomi su cui i motori concordano (vuoto se DISPUTED). */
  readonly agreedAtoms: ReadonlyArray<{ address: string; atomName: string; engines: string[] }>;
  /** Dispute atomiche con ragione semantica (vuoto se AGREED). */
  readonly disputes: ReadonlyArray<AtomicDispute>;
}

export class AtomicReconciler {
  constructor(private readonly registry: AtomicSemanticsRegistry) {}

  /**
   * Riconcilia due set di claim istruzionali da motori diversi.
   * Per ogni indirizzo presente in entrambi i set, confronta gli atomi semantici.
   * Se gli hash semantici coincidono → AGREED per quell'indirizzo.
   * Se differiscono → DISPUTED con ragione semantica derivata dai teoremi.
   */
  reconcile(
    claimsA: ReadonlyArray<InstructionClaim>,
    claimsB: ReadonlyArray<InstructionClaim>,
  ): AtomicReconciliationResult {
    const mapA = new Map<string, InstructionClaim>();
    for (const c of claimsA) mapA.set(c.address, c);

    const mapB = new Map<string, InstructionClaim>();
    for (const c of claimsB) mapB.set(c.address, c);

    const agreedAtoms: Array<{ address: string; atomName: string; engines: string[] }> = [];
    const disputes: AtomicDispute[] = [];

    // Indirizzi presenti in entrambi i set.
    const commonAddresses = [...mapA.keys()].filter((addr) => mapB.has(addr));

    for (const addr of commonAddresses) {
      const claimA = mapA.get(addr)!;
      const claimB = mapB.get(addr)!;

      const atomA = this.registry.getByName(claimA.atomName);
      const atomB = this.registry.getByName(claimB.atomName);

      if (!atomA || !atomB) {
        // Atomo non registrato: disputa esplicita (mai silente).
        disputes.push({
          address: addr,
          claimA,
          claimB,
          semanticReason: `atomo non registrato nel registry (${claimA.atomName} vs ${claimB.atomName})`,
          hashA: atomA?.semanticHash ?? 'unknown',
          hashB: atomB?.semanticHash ?? 'unknown',
        });
        continue;
      }

      if (atomA.semanticHash === atomB.semanticHash) {
        // Stesso hash semantico → accordo atomico.
        agreedAtoms.push({
          address: addr,
          atomName: atomA.name,
          engines: [claimA.engine, claimB.engine],
        });
      } else {
        // Hash diversi → disputa con ragione semantica.
        const reason = this.deriveSemanticReason(atomA, atomB);
        disputes.push({
          address: addr,
          claimA,
          claimB,
          semanticReason: reason,
          hashA: atomA.semanticHash,
          hashB: atomB.semanticHash,
        });
      }
    }

    return {
      verdict: disputes.length === 0 ? 'AGREED' : 'DISPUTED',
      agreedAtoms,
      disputes,
    };
  }

  /**
   * Deriva una ragione semantica umana per la disputa tra due atomi.
   * Confronta i teoremi di preservation: se uno modifica i flag e l'altro no,
   * o se uno scrive su un registro e l'altro no, la ragione è esplicita.
   */
  private deriveSemanticReason(atomA: AtomicSemantics, atomB: AtomicSemantics): string {
    const theoremsA = new Set(atomA.theorems);
    const theoremsB = new Set(atomB.theorems);

    // Caso classico: add vs lea (add modifica flag, lea no).
    const aModifiesFlags = [...theoremsA].some((t) => t.includes('zf') || t.includes('cf') || t.includes('flag'));
    const bModifiesFlags = [...theoremsB].some((t) => t.includes('zf') || t.includes('cf') || t.includes('flag'));

    if (aModifiesFlags && !bModifiesFlags) {
      return `${atomA.mnemonic} modifica i flag (ZF/CF), ${atomB.mnemonic} no`;
    }
    if (!aModifiesFlags && bModifiesFlags) {
      return `${atomA.mnemonic} non modifica i flag, ${atomB.mnemonic} sì`;
    }

    // Caso: uno scrive su rax, l'altro no.
    const aWritesRax = [...theoremsA].some((t) => t.includes('rax') && !t.includes('preserves'));
    const bWritesRax = [...theoremsB].some((t) => t.includes('rax') && !t.includes('preserves'));

    if (aWritesRax && !bWritesRax) {
      return `${atomA.mnemonic} scrive su RAX, ${atomB.mnemonic} no`;
    }
    if (!aWritesRax && bWritesRax) {
      return `${atomA.mnemonic} non scrive su RAX, ${atomB.mnemonic} sì`;
    }

    // Fallback: ragione generica ma esplicita.
    return `semantica diversa: ${atomA.name} (${atomA.theorems.join(', ')}) vs ${atomB.name} (${atomB.theorems.join(', ')})`;
  }
}