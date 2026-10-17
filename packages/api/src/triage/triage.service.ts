/**
 * Triage aggregato (M1): un binario → tutto ciò che la piattaforma sa su di
 * lui, in una risposta. È il workflow chiuso del track M: carica → analizza →
 * ipotesi → consultazione di squadra, persistente via REVRA_DB.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AnalysisResult, Hypothesis } from '@revra/contracts';
import type { EpistemicEngine } from '@revra/engine';
import { EvidenceKernel } from '@revra/kernel';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { EPISTEMIC_ENGINE } from '../epistemic/tokens.js';

export interface TriageSummary {
  binaryHash: string;
  results: AnalysisResult[];
  hypotheses: Hypothesis[];
  counts: {
    results: number;
    byState: Record<string, number>;
    hypotheses: number;
    confirmed: number;
    falsified: number;
    proposed: number;
  };
}

@Injectable()
export class TriageService {
  @Inject(EVIDENCE_KERNEL)
  private readonly kernel!: EvidenceKernel;

  @Inject(EPISTEMIC_ENGINE)
  private readonly epistemic!: EpistemicEngine;

  summary(binaryHash: string, tenantId?: string): TriageSummary {
    const results = this.kernel
      .listResults()
      .filter((r) => r.binaryHash === binaryHash)
      .filter((r) => !tenantId || !r.tenantId || r.tenantId === tenantId);
    const hypotheses = this.epistemic
      .listHypotheses()
      .filter((h) => h.binaryHash === binaryHash);

    const byState: Record<string, number> = {};
    for (const r of results) {
      byState[r.verification.state] = (byState[r.verification.state] ?? 0) + 1;
    }

    return {
      binaryHash,
      results,
      hypotheses,
      counts: {
        results: results.length,
        byState,
        hypotheses: hypotheses.length,
        confirmed: hypotheses.filter((h) => h.status === 'CONFIRMED').length,
        falsified: hypotheses.filter((h) => h.status === 'FALSIFIED').length,
        proposed: hypotheses.filter((h) => h.status === 'PROPOSED').length,
      },
    };
  }
}
