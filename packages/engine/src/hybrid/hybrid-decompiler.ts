/**
 * HybridDecompiler (PRD §3.1): orchestrates Neural Proposal → Structural
 * Validation (+ later Behavioral Testing / Formal Proof). Every candidate
 * enters the kernel as an AI proposal at L1 — the kernel alone decides
 * promotions — and every symbolic verdict carries an evidence reference.
 * Refuted candidates feed the falsification ledger (learning signal).
 */
import type { AnalysisResult, EvidenceLevel } from '@revra/contracts';
import { EvidenceKernel } from '@revra/kernel';
import { HybridMetricsTracker, type HybridMetricsSnapshot } from './metrics.js';
import { neuralActor, symbolicActor } from './types.js';
import type {
  CandidateOutcome,
  CandidateVerdict,
  DecompileContext,
  HybridCandidateReport,
  HybridRunReport,
  NeuralProposer,
  SymbolicVerifier,
} from './types.js';

export interface HybridDecompilerOptions {
  idGen?: () => string;
  now?: () => string;
}

export interface FalsificationEntry {
  resultId: string;
  claim: unknown;
  confidence: number;
  evidenceRef: string;
  reason?: string;
  ts: string;
}

export class HybridDecompiler {
  private readonly metrics = new HybridMetricsTracker();
  private readonly falsificationLedger: FalsificationEntry[] = [];
  private seq = 0;

  constructor(
    private readonly deps: {
      kernel: EvidenceKernel;
      proposer: NeuralProposer;
      verifier: SymbolicVerifier;
    },
    private readonly options: HybridDecompilerOptions = {},
  ) {}

  async run(ctx: DecompileContext): Promise<HybridRunReport> {
    const t0 = performance.now();
    const { kernel, proposer, verifier } = this.deps;
    const candidates = await proposer.propose(ctx);
    const reports: HybridCandidateReport[] = [];

    for (const candidate of candidates) {
      // The kernel pins AI submissions to L1 (AI Authority Boundary).
      const result = kernel.submit(
        {
          binaryHash: ctx.binaryHash,
          arch: ctx.arch,
          addressRange: ctx.addressRange,
          engineSource: `neural:${candidate.modelId}@${candidate.modelVersion}`,
          claim: candidate.claim,
        },
        neuralActor(proposer),
      );

      const verdict = await verifier.verify(candidate, ctx);
      reports.push(
        this.applyVerdict(result, candidate.confidence, verdict, ctx),
      );
    }

    this.metrics.recordRun(reports.map((r) => ({ outcome: r.outcome, confidence: r.confidence })));
    return {
      runId: this.nextId('hybrid-run'),
      ctx,
      candidates: reports,
      durationMs: performance.now() - t0,
    };
  }

  metricsSnapshot(): HybridMetricsSnapshot {
    return this.metrics.snapshot();
  }

  /** Falsification ledger — the continuous-learning signal (PRD §3.1). */
  falsifications(): FalsificationEntry[] {
    return [...this.falsificationLedger];
  }

  private applyVerdict(
    result: AnalysisResult,
    confidence: number,
    verdict: CandidateVerdict,
    ctx: DecompileContext,
  ): HybridCandidateReport {
    const { kernel, verifier } = this.deps;
    const judge = symbolicActor(verifier);

    if (verdict.outcome === 'VERIFIED' && verdict.evidenceRef) {
      const promoted: EvidenceLevel = 'L2';
      kernel.promote(result.id, promoted, judge, { evidenceRef: verdict.evidenceRef });
      return {
        resultId: result.id,
        confidence,
        outcome: 'VERIFIED_PROMOTED',
        evidenceRef: verdict.evidenceRef,
      };
    }

    if (verdict.outcome === 'REFUTED' && verdict.evidenceRef) {
      kernel.refute(result.id, judge, {
        evidenceRef: verdict.evidenceRef,
        reason: verdict.reason,
      });
      this.falsificationLedger.push({
        resultId: result.id,
        claim: result.claim,
        confidence,
        evidenceRef: verdict.evidenceRef,
        reason: verdict.reason,
        ts: this.now(),
      });
      void ctx;
      return {
        resultId: result.id,
        confidence,
        outcome: 'REFUTED',
        evidenceRef: verdict.evidenceRef,
        reason: verdict.reason,
      };
    }

    // INCONCLUSIVE: the candidate stays L1 — explicit non-decision, no warning.
    return { resultId: result.id, confidence, outcome: 'INCONCLUSIVE' };
  }

  private nextId(prefix: string): string {
    return this.options.idGen ? this.options.idGen() : `${prefix}-${++this.seq}`;
  }

  private now(): string {
    return this.options.now ? this.options.now() : new Date().toISOString();
  }
}
