import { Module } from '@nestjs/common';
import type { EvidenceKernel } from '@revra/kernel';
import {
  ConsensusEngine,
  HybridDecompiler,
  MockNeuralProposer,
  StructuralRuleVerifier,
} from '@revra/engine';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { CONSENSUS_ENGINE, HYBRID_DECOMPILER } from './tokens.js';
import { EngineController } from './engine.controller.js';
import { EngineService } from './engine.service.js';

/**
 * G2 orchestration on top of the shared kernel: hybrid pipeline (mock neural
 * proposer + structural symbolic verifier) and the BFT consensus engine.
 */
@Module({
  imports: [AnalysisModule],
  controllers: [EngineController],
  providers: [
    {
      provide: HYBRID_DECOMPILER,
      useFactory: (kernel: EvidenceKernel) =>
        new HybridDecompiler({
          kernel,
          proposer: new MockNeuralProposer(),
          verifier: new StructuralRuleVerifier(),
        }),
      inject: [EVIDENCE_KERNEL],
    },
    { provide: CONSENSUS_ENGINE, useFactory: () => new ConsensusEngine() },
    EngineService,
  ],
})
export class EngineModule {}
