import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  ConsensusDecision,
  ConsensusMetricsSnapshot,
  DecompileContext,
  EngineSubmission,
  HybridMetricsSnapshot,
  HybridRunReport,
  SharedFormalSnapshot,
} from '@revra/engine';
import {
  ConsensusEngine,
  HybridDecompiler,
  MockNeuralProposer,
  StructuralRuleVerifier,
} from '@revra/engine';
import { HYBRID_DECOMPILER, CONSENSUS_ENGINE } from './tokens.js';

const decompileBodySchema = z.object({
  binaryHash: z.string().min(8),
  arch: z.string().min(1),
  addressRange: z.object({ start: z.string().min(1), end: z.string().min(1) }),
});

const consensusBodySchema = z.object({
  submissions: z
    .array(
      z.object({
        engineId: z.string().min(1),
        binaryHash: z.string().min(8),
        addressRange: z.object({ start: z.string().min(1), end: z.string().min(1) }),
        claim: z.object({ kind: z.string().min(1), payload: z.unknown() }),
      }),
    )
    .min(1),
});

/**
 * Orchestration facade for G2: the hybrid pipeline and the consensus engine
 * share the SAME kernel instance as the analysis module — one evidence truth.
 * Default neural proposer is the deterministic mock; default symbolic
 * verifier is the structural-rule stage (behavioral testing lands with the
 * engine containers).
 */
@Injectable()
export class EngineService {
  @Inject(HYBRID_DECOMPILER)
  private readonly hybrid!: HybridDecompiler;

  @Inject(CONSENSUS_ENGINE)
  private readonly consensus!: ConsensusEngine;

  decompile(body: unknown): Promise<HybridRunReport> {
    const ctx = decompileBodySchema.parse(body) as DecompileContext;
    return this.hybrid.run(ctx);
  }

  hybridMetrics(): HybridMetricsSnapshot {
    return this.hybrid.metricsSnapshot();
  }

  falsifications() {
    return this.hybrid.falsifications();
  }

  consensusRound(body: unknown): ConsensusDecision {
    const { submissions } = consensusBodySchema.parse(body);
    return this.consensus.submitRound(submissions as EngineSubmission[]);
  }

  consensusMetrics(): ConsensusMetricsSnapshot {
    return this.consensus.metrics();
  }

  sharedState(): SharedFormalSnapshot {
    return this.consensus.sharedState.snapshot();
  }
}
