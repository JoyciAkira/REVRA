/**
 * A1++.5 — AtomicKnowledgeStore (PRD §3.3, Beyond Limits).
 *
 * Estende l'Epistemic Engine per imparare SEQUENZE ATOMICHE riutilizzabili:
 * invece di pattern vaghi su funzioni intere, il motore accumula conoscenza
 * a livello di sequenza di atomi istruzionali verificati (A1++.1).
 *
 * Esempio: la sequenza [mov_reg_imm(60), syscall] = "exit(60)" appare in 847
 * binari della famiglia malware-X. Quando il motore rivede questa sequenza in
 * un nuovo binario, non genera un'ipotesi vaga — SA già cosa fa, con una
 * confidence cumulata basata su quante volte la sequenza è stata confermata
 * vs falsificata cross-binario.
 *
 * Questo è il flywheel di conoscenza atomica: ogni analisi alimenta il corpus,
 * e ogni nuova analisi beneficia di tutto ciò che è stato imparato prima.
 * Coerente col principio "atomicità": la conoscenza si accumula su unità
 * indivisibili e componibili, non su blob arbitrari.
 *
 * Confidence: Wilson score interval (come l'Epistemic Engine esistente) +
 * conformal prediction calibrata (B2): l'intervallo si allarga quando il
 * corpus è sottile o la falsification rate è alta (incertezza epistemica onesta,
 * mai un numero senza margine — mitigazione rischio PRD §10).
 */
import { createHash } from 'node:crypto';

export interface AtomicSequence {
  /** Hash deterministico della sequenza di atomi (identità reale della conoscenza). */
  readonly sequenceHash: string;
  /** Nomi degli atomi in ordine (es. ['mov_reg_imm', 'syscall']). */
  readonly atomNames: ReadonlyArray<string>;
  /** Mnemonico umano della sequenza (es. "mov imm; syscall"). */
  readonly mnemonic: string;
}

export interface AtomicKnowledgeEntry {
  readonly sequence: AtomicSequence;
  /** Interpretazione semantica appresa (es. "exit(60)", "return value in eax"). */
  interpretation: string;
  /** Quante volte la sequenza è stata confermata (verdetto positivo) cross-binario. */
  confirmed: number;
  /** Quante volte la sequenza è stata falsificata (interpretazione sbagliata). */
  falsified: number;
  /** Binari distinti in cui la sequenza è stata osservata (evita double-counting). */
  readonly observedInBinaries: Set<string>;
  /** Timestamp dell'ultima osservazione. */
  lastSeenTs: string;
}

export interface AtomicHypothesis {
  /** Sequenza atomica riconosciuta nel nuovo binario. */
  readonly sequence: AtomicSequence;
  /** Interpretazione proposta dal corpus accumulato. */
  readonly interpretation: string;
  /** Confidence puntuale (Wilson score) in [0,1]. */
  readonly confidence: number;
  /** Intervallo di incertezza calibrato (conformal): mai un numero senza margine. */
  readonly uncertaintyInterval: { lower: number; upper: number; coverage: number };
  /** Quanti binari distinti supportano questa conoscenza. */
  readonly supportingBinaries: number;
}

/**
 * Calcola la confidence puntuale via Wilson score interval (centro).
 * Robusto anche con pochi sample (a differenza della proporzione naive p=k/n
 * che sovrastima con n piccolo). Mitiga il rischio PRD §10 "alta confidenza
 * fuorviante su corpus sottile".
 */
function wilsonScore(confirmed: number, falsified: number, z = 1.96): number {
  const n = confirmed + falsified;
  if (n === 0) return 0;
  const p = confirmed / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  return Math.max(0, Math.min(1, center));
}

/**
 * Intervallo conformal calibrato: si allarga quando il corpus è sottile
 * (n piccolo) o la falsification rate è alta. Garantisce che l'UI mostri
 * SEMPRE il margine di incertezza, non solo il punto di confidenza.
 */
function conformalInterval(
  confirmed: number,
  falsified: number,
  coverage = 0.9,
): { lower: number; upper: number; coverage: number } {
  const n = confirmed + falsified;
  const point = wilsonScore(confirmed, falsified);
  if (n === 0) {
    // Corpus vuoto: incertezza massima onesta.
    return { lower: 0, upper: 1, coverage };
  }
  // Larghezza dell'intervallo: inversamente proporzionale a sqrt(n),
  // direttamente proporzionale alla falsification rate.
  const falsificationRate = falsified / n;
  const z = coverage >= 0.95 ? 1.96 : 1.645;
  const halfWidth = z * Math.sqrt((point * (1 - point)) / n + falsificationRate * 0.1);
  const lower = Math.max(0, point - halfWidth);
  const upper = Math.min(1, point + halfWidth);
  return { lower, upper, coverage };
}

export class AtomicKnowledgeStore {
  private readonly entries: Map<string, AtomicKnowledgeEntry> = new Map();

  /**
   * Calcola l'hash deterministico di una sequenza di atomi.
   * L'identità della conoscenza è la sequenza semantica, non i byte grezzi:
   * due binari diversi con la stessa sequenza di atomi condividono la conoscenza.
   */
  static hashSequence(atomNames: ReadonlyArray<string>): string {
    return createHash('sha256').update(atomNames.join('|')).digest('hex');
  }

  /**
   * Costruisce una sequenza atomica da una lista di nomi atomo.
   */
  static buildSequence(atomNames: ReadonlyArray<string>, mnemonic?: string): AtomicSequence {
    return {
      sequenceHash: AtomicKnowledgeStore.hashSequence(atomNames),
      atomNames: [...atomNames],
      mnemonic: mnemonic ?? atomNames.join('; '),
    };
  }

  /**
   * Registra un'osservazione: la sequenza è stata vista in un binario con
   * una certa interpretazione. Se la sequenza è nuova, crea un entry.
   * Se esiste già, incrementa il contatore (solo se il binario non era già contato).
   *
   * @param confirmed true se l'interpretazione è stata verificata corretta,
   *                  false se è stata falsificata (meta-learning sugli errori).
   */
  observe(
    sequence: AtomicSequence,
    interpretation: string,
    binaryHash: string,
    confirmed: boolean,
  ): AtomicKnowledgeEntry {
    const existing = this.entries.get(sequence.sequenceHash);
    if (existing) {
      // Aggiorna solo se il binario non era già contato (evita double-counting).
      if (!existing.observedInBinaries.has(binaryHash)) {
        existing.observedInBinaries.add(binaryHash);
        if (confirmed) {
          existing.confirmed += 1;
        } else {
          existing.falsified += 1;
        }
      }
      existing.lastSeenTs = new Date().toISOString();
      // Se l'interpretazione è più recente e confermata, aggiorna.
      if (confirmed && existing.interpretation !== interpretation) {
        existing.interpretation = interpretation;
      }
      return existing;
    }
    // Nuovo entry.
    const entry: AtomicKnowledgeEntry = {
      sequence,
      interpretation,
      confirmed: confirmed ? 1 : 0,
      falsified: confirmed ? 0 : 1,
      observedInBinaries: new Set([binaryHash]),
      lastSeenTs: new Date().toISOString(),
    };
    this.entries.set(sequence.sequenceHash, entry);
    return entry;
  }

  /**
   * Genera un'ipotesi atomica per una sequenza osservata in un nuovo binario.
   * La confidence è cumulata su TUTTI i binari precedenti (cross-binario),
   * non solo sul binario corrente. Questo è il flywheel: più si analizza,
   * più il motore sa.
   *
   * Ritorna null se la sequenza non è mai stata vista prima (nessuna conoscenza
   * accumulata → nessuna ipotesi, coerente con "mai silente": se non so, dico
   * che non so invece di inventare).
   */
  hypothesize(sequence: AtomicSequence): AtomicHypothesis | null {
    const entry = this.entries.get(sequence.sequenceHash);
    if (!entry || entry.confirmed + entry.falsified === 0) {
      return null; // Nessuna conoscenza accumulata.
    }
    const confidence = wilsonScore(entry.confirmed, entry.falsified);
    const uncertaintyInterval = conformalInterval(entry.confirmed, entry.falsified);
    return {
      sequence,
      interpretation: entry.interpretation,
      confidence,
      uncertaintyInterval,
      supportingBinaries: entry.observedInBinaries.size,
    };
  }

  /**
   * Recupera un entry per hash di sequenza (per diagnostica e persistenza).
   */
  getEntry(sequenceHash: string): AtomicKnowledgeEntry | undefined {
    return this.entries.get(sequenceHash);
  }

  /**
   * Numero di sequenze atomiche distinte apprese (metrica di crescita del corpus).
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Metriche aggregate dello store: quante sequenze, quanti confirm/falsify totali,
   * accuracy cumulata. Usate per il self-improvement loop (B2) e per i report SLO.
   */
  metrics(): {
    sequences: number;
    totalConfirmed: number;
    totalFalsified: number;
    accuracy: number | null;
    topSequences: Array<{ mnemonic: string; confidence: number; binaries: number }>;
  } {
    let totalConfirmed = 0;
    let totalFalsified = 0;
    const top: Array<{ mnemonic: string; confidence: number; binaries: number }> = [];
    for (const entry of this.entries.values()) {
      totalConfirmed += entry.confirmed;
      totalFalsified += entry.falsified;
      const conf = wilsonScore(entry.confirmed, entry.falsified);
      top.push({
        mnemonic: entry.sequence.mnemonic,
        confidence: conf,
        binaries: entry.observedInBinaries.size,
      });
    }
    const total = totalConfirmed + totalFalsified;
    top.sort((a, b) => b.confidence - a.confidence || b.binaries - a.binaries);
    return {
      sequences: this.entries.size,
      totalConfirmed,
      totalFalsified,
      accuracy: total > 0 ? totalConfirmed / total : null,
      topSequences: top.slice(0, 10),
    };
  }

  /**
   * Esporta lo stato per la persistenza (coerente con EpistemicEngine.exportState).
   * Le Set vengono serializzate come array.
   */
  exportState(): Array<{
    sequenceHash: string;
    atomNames: string[];
    mnemonic: string;
    interpretation: string;
    confirmed: number;
    falsified: number;
    observedInBinaries: string[];
    lastSeenTs: string;
  }> {
    return [...this.entries.values()].map((e) => ({
      sequenceHash: e.sequence.sequenceHash,
      atomNames: [...e.sequence.atomNames],
      mnemonic: e.sequence.mnemonic,
      interpretation: e.interpretation,
      confirmed: e.confirmed,
      falsified: e.falsified,
      observedInBinaries: [...e.observedInBinaries],
      lastSeenTs: e.lastSeenTs,
    }));
  }

  /**
   * Ripristina lo stato da un export (coerente con EpistemicEngine.restore).
   */
  restoreState(
    state: Array<{
      sequenceHash: string;
      atomNames: string[];
      mnemonic: string;
      interpretation: string;
      confirmed: number;
      falsified: number;
      observedInBinaries: string[];
      lastSeenTs: string;
    }>,
  ): void {
    this.entries.clear();
    for (const s of state) {
      const sequence: AtomicSequence = {
        sequenceHash: s.sequenceHash,
        atomNames: s.atomNames,
        mnemonic: s.mnemonic,
      };
      this.entries.set(s.sequenceHash, {
        sequence,
        interpretation: s.interpretation,
        confirmed: s.confirmed,
        falsified: s.falsified,
        observedInBinaries: new Set(s.observedInBinaries),
        lastSeenTs: s.lastSeenTs,
      });
    }
  }
}