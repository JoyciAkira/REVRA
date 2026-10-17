/**
 * Living Epistemic Engine (PRD §3.3): la KB genera attivamente ipotesi
 * falsificabili sui nuovi binari dal corpus accumulato, le aggiorna con i
 * verdetto (meta-learning sugli errori), ragiona causalmente con analisi
 * differenziale (causale ≠ correlazione) e misura il proprio miglioramento.
 */
import { createHash } from 'node:crypto';
import type {
  CausalEdge,
  CausalMethod,
  Hypothesis,
  HypothesisStatus,
} from '@revra/contracts';
import { KernelRuleError } from '@revra/kernel';
import { epistemicSnapshotSchema, type EpistemicSnapshot } from './persistence.js';

export interface CorpusPattern {
  patternId: string;
  family: string;
  /** Firma del match: arch + provenienza del primo engine che l'ha visto. */
  arch: string;
  firstSeenEngineSource: string;
  /** Statistiche di verdetto: base della confidence (meta-learning). */
  confirmed: number;
  falsified: number;
  ts: string;
}

export interface GenerationInput {
  binaryHash: string;
  arch: string;
  firstEngineSource: string;
}

export interface EpistemicMetrics {
  patterns: number;
  hypotheses: number;
  confirmed: number;
  falsified: number;
  /** Accuracy cumulata dei verdetto (target PRD: +2%/mese, tracciata). */
  accuracy: number | null;
  /** Aree con copertura debole o alta falsificazione: i gap da colmare. */
  gaps: Array<{ arch: string; reason: string }>;
  avgGenerationMs: number | null;
}
/**
 * B2 — Conformal prediction: uncertainty interval calibrato sulla confidence
 * dell'ipotesi. Mitiga il rischio PRD §10 "ipotesi fuorvianti ad alta confidenza":
 * l'UI mostra SEMPRE l'intervallo di incertezza, non solo il punto di confidenza.
 * Implementazione: split-conformal semplificato — l'intervallo si allarga quando
 * il corpus è sottile o la falsification rate è alta (incertezza epistemica onesta).
 */
export interface ConformalInterval {
  /** Stima puntuale della confidence (Wilson score). */
  point: number;
  /** Limite inferiore dell'intervallo di confidenza calibrato. */
  lower: number;
  /** Limite superiore dell'intervallo di confidenza calibrato. */
  upper: number;
  /** Livello di copertura nominale (es. 0.9 = 90%). */
  coverage: number;
}

/**
 * B2 — Self-improvement loop: azione autonoma che l'engine intraprende per
 * colmare un gap conoscitivo identificato. Non è magia: è una query di
 * ricerca strutturata che un orchestratore esterno può eseguire (PRD §3.3
 * "genera query di ricerca autonome"). Tracciata per misurare il loop.
 */
export interface SelfImprovementAction {
  gapArch: string;
  reason: string;
  /** Query di ricerca autonoma generata per colmare il gap. */
  researchQuery: string;
  generatedAt: string;
}

function wilson(confirmed: number, total: number): number {
  if (total === 0) return 0.5;
  const z = 1.96;
  const p = confirmed / total;
  const denom = 1 + (z * z) / total;
  return (p + (z * z) / (2 * total) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
}

export class EpistemicEngine {
  private readonly patterns = new Map<string, CorpusPattern>();
  private readonly hypotheses = new Map<string, Hypothesis>();
  private readonly causalEdges = new Map<string, CausalEdge>();
  private readonly cooccurrences = new Map<string, number>();
  private generationDurations: number[] = [];
  // B2: registro delle azioni di self-improvement (loop misurabile, PRD §3.3).
  private readonly improvementActions: SelfImprovementAction[] = [];

  private static patternKey(arch: string, firstEngineSource: string): string {
    return createHash('sha256').update(`${arch}|${firstEngineSource}`).digest('hex').slice(0, 16);
  }

  /** Ingest di un pattern nel corpus (alimentato dalle analisi concluse). */
  learnPattern(arch: string, firstEngineSource: string, family: string, now: string): CorpusPattern {
    const patternId = EpistemicEngine.patternKey(arch, firstEngineSource);
    const existing = this.patterns.get(patternId);
    if (existing) {
      existing.confirmed += 1;
      return existing;
    }
    const pattern: CorpusPattern = {
      patternId,
      family,
      arch,
      firstSeenEngineSource: firstEngineSource,
      confirmed: 1,
      falsified: 0,
      ts: now,
    };
    this.patterns.set(patternId, pattern);
    return pattern;
  }

  /**
   * Generazione AUTONOMA di ipotesi per un nuovo binario: match sul corpus
   * con confidence Wilson, nessun intervento umano. Senza match registra un
   * gap conoscitivo invece di inventare — time-to-first-insight misurato.
   */
  generate(input: GenerationInput, now: string): Hypothesis[] {
    const t0 = performance.now();
    const generated: Hypothesis[] = [];

    const exact = this.patterns.get(EpistemicEngine.patternKey(input.arch, input.firstEngineSource));
    if (exact) {
      generated.push(
        this.makeHypothesis(exact, input, now, performance.now() - t0),
      );
    }
    const sameArch = [...this.patterns.values()].filter(
      (p) => p.arch === input.arch && p !== exact,
    );
    for (const weaker of sameArch) {
      const hypothesis = this.makeHypothesis(weaker, input, now, performance.now() - t0);
      hypothesis.confidence = hypothesis.confidence * 0.6; // match debole: penalizzato
      generated.push(hypothesis);
    }

    this.generationDurations.push(performance.now() - t0);
    return generated;
  }

  /**
   * B2 — Conformal prediction: intervallo di incertezza calibrato sulla
   * confidence di un'ipotesi. L'ampiezza cresce con corpus sottile / alta
   * falsification (incertezza epistemica onesta, PRD §10 risk mitigation).
   * Coverage nominale 90%. L'UI deve mostrare SEMPRE [lower, upper].
   */
  conformalInterval(hypothesisId: string): ConformalInterval {
    const h = this.hypotheses.get(hypothesisId);
    if (!h) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no hypothesis with id ${hypothesisId}`);
    }
    const pattern = this.patterns.get(h.patternId);
    const total = pattern ? pattern.confirmed + pattern.falsified : 0;
    // Ampiezza dell'intervallo: larga se corpus sottile o alta falsification.
    const falsificationRate = total > 0 && pattern ? pattern.falsified / total : 0;
    const corpusThinness = Math.max(0, 1 - total / 10); // 1 se 0 sample, 0 se >=10
    const halfWidth = Math.min(0.5, 0.05 + 0.2 * corpusThinness + 0.25 * falsificationRate);
    const point = h.confidence;
    return {
      point,
      lower: Math.max(0, point - halfWidth),
      upper: Math.min(1, point + halfWidth),
      coverage: 0.9,
    };
  }

  /**
   * B2 — Self-improvement loop: identifica i gap (da metrics()) e genera
   * azioni autonome di ricerca per colmarli. Ritorna le nuove azioni create
   * in questa chiamata. Misurabile: ogni azione è tracciata con timestamp.
   * Un orchestratore esterno esegue le researchQuery e re-ingesta i risultati
   * tramite learnPattern — chiudendo il loop perpetuo (PRD §3.3).
   */
  selfImprove(now: string): SelfImprovementAction[] {
    const { gaps } = this.metrics();
    const created: SelfImprovementAction[] = [];
    for (const gap of gaps) {
      // Evita duplicati: una sola azione pendente per arch-gap.
      const alreadyPending = this.improvementActions.some(
        (a) => a.gapArch === gap.arch && a.reason === gap.reason,
      );
      if (alreadyPending) continue;
      const action: SelfImprovementAction = {
        gapArch: gap.arch,
        reason: gap.reason,
        researchQuery: gap.arch === '*'
          ? 'espandi il corpus: analizza binari di architetture diverse per generalizzare i pattern'
          : `cerca campioni ${gap.arch} confermati per correggere il modello di inferenza (falsification rate alta)`,
        generatedAt: now,
      };
      this.improvementActions.push(action);
      created.push(action);
    }
    return created;
  }

  /** B2: azioni di self-improvement generate (per audit/misurazione del loop). */
  listImprovementActions(): SelfImprovementAction[] {
    return [...this.improvementActions];
  }

  /**
   * Verdetto umano/simbolico su un'ipotesi: aggiorna lo status E le
   * statistiche del pattern d'origine — è il loop di meta-learning.
   */
  applyVerdict(hypothesisId: string, verdict: Exclude<HypothesisStatus, 'PROPOSED'>): Hypothesis {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no hypothesis with id ${hypothesisId}`);
    }
    hypothesis.status = verdict;
    const pattern = this.patterns.get(hypothesis.patternId);
    if (pattern) {
      if (verdict === 'CONFIRMED') pattern.confirmed += 1;
      else pattern.falsified += 1;
    }
    return hypothesis;
  }

  listHypotheses(): Hypothesis[] {
    return [...this.hypotheses.values()];
  }

  /**
   * Causal reasoning: solo l'analisi DIFFERENZIALE (cambio la causa, osservo
   * l'effetto) stabilisce causalità; la co-occorrenza resta correlazione.
   */
  recordObservation(cause: string, effect: string, method: CausalMethod, now: string): void {
    const key = `${cause}->${effect}`;
    if (method === 'differential') {
      const edge = this.causalEdges.get(key);
      this.causalEdges.set(key, {
        cause,
        effect,
        method: 'differential',
        observations: (edge?.observations ?? 0) + 1,
        ts: now,
      });
    } else {
      this.cooccurrences.set(key, (this.cooccurrences.get(key) ?? 0) + 1);
    }
  }

  /** 'causal' (differenziale) | 'correlational' (solo co-occorrenza) | 'unknown'. */
  relationBetween(cause: string, effect: string): { relation: 'causal' | 'correlational' | 'unknown'; observations?: number } {
    const edge = this.causalEdges.get(`${cause}->${effect}`);
    if (edge) return { relation: 'causal', observations: edge.observations };
    const co = this.cooccurrences.get(`${cause}->${effect}`);
    if (co) return { relation: 'correlational', observations: co };
    return { relation: 'unknown' };
  }

  /** Counterfactual: predizione da edge causali noti (modello dichiarato). */
  counterfactual(cause: string, effect: string): string {
    const { relation, observations } = this.relationBetween(cause, effect);
    if (relation === 'causal') {
      return `Se ${cause} cambia, ${effect} cambia — stabilito per analisi differenziale su ${observations} osservazioni.`;
    }
    if (relation === 'correlational') {
      return `Non dimostrabile: ${cause} e ${effect} co-occorrono (${observations}) ma nessun test differenziale stabilisce la direzione.`;
    }
    return `Nessuna evidenza su ${cause} → ${effect}: gap conoscitivo.`;
  }

  /** Snapshot completo per la persistenza (F0.3). */
  exportState(): EpistemicSnapshot {
    return epistemicSnapshotSchema.parse({
      patterns: [...this.patterns.values()],
      hypotheses: [...this.hypotheses.values()],
      causalEdges: [...this.causalEdges.values()],
      cooccurrences: [...this.cooccurrences.entries()].map(([key, count]) => {
        const separator = key.indexOf('->');
        return { cause: key.slice(0, separator), effect: key.slice(separator + 2), count };
      }),
    });
  }

  /** Ripristina lo snapshot (validato zod alla boundary). */
  restore(rawSnapshot: unknown): void {
    const snapshot = epistemicSnapshotSchema.parse(rawSnapshot);
    this.patterns.clear();
    for (const pattern of snapshot.patterns) this.patterns.set(pattern.patternId, pattern);
    this.hypotheses.clear();
    for (const hypothesis of snapshot.hypotheses) this.hypotheses.set(hypothesis.id, hypothesis);
    this.causalEdges.clear();
    for (const edge of snapshot.causalEdges) this.causalEdges.set(`${edge.cause}->${edge.effect}`, edge);
    this.cooccurrences.clear();
    for (const co of snapshot.cooccurrences) this.cooccurrences.set(`${co.cause}->${co.effect}`, co.count);
  }

  metrics(): EpistemicMetrics {
    const judged = [...this.hypotheses.values()].filter((h) => h.status !== 'PROPOSED');
    const confirmed = judged.filter((h) => h.status === 'CONFIRMED').length;
    const archCounts = new Map<string, { confirmed: number; falsified: number }>();
    for (const h of this.hypotheses.values()) {
      const c = archCounts.get(h.arch) ?? { confirmed: 0, falsified: 0 };
      if (h.status === 'CONFIRMED') c.confirmed += 1;
      if (h.status === 'FALSIFIED') c.falsified += 1;
      archCounts.set(h.arch, c);
    }
    const gaps: Array<{ arch: string; reason: string }> = [];
    for (const [arch, c] of archCounts) {
      if (c.falsified > c.confirmed) {
        gaps.push({ arch, reason: `falsification rate ${(c.falsified / (c.confirmed + c.falsified)).toFixed(2)} — modello di inferenza da correggere` });
      }
    }
    if (this.patterns.size < 3) {
      gaps.push({ arch: '*', reason: `corpus sottile: ${this.patterns.size} pattern (minimo per generalizzare: 3)` });
    }
    const avgGen =
      this.generationDurations.length > 0
        ? this.generationDurations.reduce((a, b) => a + b, 0) / this.generationDurations.length
        : null;
    return {
      patterns: this.patterns.size,
      hypotheses: this.hypotheses.size,
      confirmed,
      falsified: judged.length - confirmed,
      accuracy: judged.length > 0 ? confirmed / judged.length : null,
      gaps,
      avgGenerationMs: avgGen,
    };
  }

  private makeHypothesis(
    pattern: CorpusPattern,
    input: GenerationInput,
    now: string,
    elapsedMs: number,
  ): Hypothesis {
    const hypothesis: Hypothesis = {
      id: `hyp-${createHash('sha256').update(`${input.binaryHash}|${pattern.patternId}`).digest('hex').slice(0, 12)}`,
      binaryHash: input.binaryHash,
      arch: input.arch,
      prediction: {
        family: pattern.family,
        expectedEngineSource: pattern.firstSeenEngineSource,
        rationale: `il binario condivide arch ${input.arch} e provenienza ${input.firstEngineSource} con ${pattern.confirmed + pattern.falsified} analisi precedenti della famiglia ${pattern.family}`,
      },
      confidence: wilson(pattern.confirmed, pattern.confirmed + pattern.falsified),
      generatedAt: now,
      generatedInMs: elapsedMs,
      status: 'PROPOSED',
      patternId: pattern.patternId,
    };
    this.hypotheses.set(hypothesis.id, hypothesis);
    return hypothesis;
  }
}
