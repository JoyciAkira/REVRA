/**
 * Hybrid pipeline metrics (PRD §3.1): first-attempt correctness over judged
 * candidates is the >95% target tracker; inconclusive runs don't count as
 * either success or failure.
 */
export type JudgedOutcome = 'VERIFIED_PROMOTED' | 'REFUTED' | 'INCONCLUSIVE';

export interface HybridMetricsSnapshot {
  proposals: number;
  verified: number;
  refuted: number;
  inconclusive: number;
  /** verified / (verified + refuted) — null before the first judged candidate. */
  firstAttemptCorrectness: number | null;
  avgConfidence: number | null;
  runs: number;
}

export class HybridMetricsTracker {
  private proposals = 0;
  private verified = 0;
  private refuted = 0;
  private inconclusive = 0;
  private confidences: number[] = [];
  private runs = 0;

  recordRun(candidateOutcomes: Array<{ outcome: JudgedOutcome; confidence: number }>): void {
    this.runs += 1;
    for (const c of candidateOutcomes) {
      this.proposals += 1;
      this.confidences.push(c.confidence);
      if (c.outcome === 'VERIFIED_PROMOTED') this.verified += 1;
      else if (c.outcome === 'REFUTED') this.refuted += 1;
      else this.inconclusive += 1;
    }
  }

  snapshot(): HybridMetricsSnapshot {
    const judged = this.verified + this.refuted;
    return {
      proposals: this.proposals,
      verified: this.verified,
      refuted: this.refuted,
      inconclusive: this.inconclusive,
      firstAttemptCorrectness: judged > 0 ? this.verified / judged : null,
      avgConfidence:
        this.confidences.length > 0
          ? this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length
          : null,
      runs: this.runs,
    };
  }
}
