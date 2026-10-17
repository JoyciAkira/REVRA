import { Module } from '@nestjs/common';
import { Lean4CliVerifier } from '@revra/kernel';
import { EvidenceKernel } from '@revra/kernel';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';
import { EVIDENCE_KERNEL } from '../tokens.js';

/**
 * G2 providers must see the SAME kernel instance as the analysis module:
 * AnalysisModule exports the EVIDENCE_KERNEL token.
 */
@Module({
  controllers: [AnalysisController],
  providers: [
    {
      provide: EVIDENCE_KERNEL,
      useFactory: async () => {
        const kernel = new EvidenceKernel();
        const verifier = await Lean4CliVerifier.detect();
        if (verifier) {
          kernel.useVerifier(verifier);
        }
        return kernel;
      },
    },
    AnalysisService,
  ],
  exports: [EVIDENCE_KERNEL],
})
export class AnalysisModule {}
